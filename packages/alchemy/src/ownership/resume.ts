/**
 * Whether this apply RESUMES a create or replace the engine already started for this resource AND
 * the live object it will find is proven that generation's own — the one case in which a stateless
 * `reconcile` may write over a live object without `--adopt`.
 *
 * ★ HOW THE ENGINE TELLS US. Alchemy calls `diff` whenever a state row exists, and hands it `output`
 *   = that row's attributes (alchemy beta.79 Plan.ts). A row with NO attributes is exactly an
 *   unfinished generation: `creating` (a create interrupted after its write, before its commit),
 *   `replacing` (the same for a replace), or `deleting` re-driven as a create. A fresh create is
 *   never diffed at all. So the diff of such a row decides, and the apply that follows (the same
 *   instance id: Apply.ts reuses the row's) finds the note.
 * ⛔ A ROW PROVES NOTHING BY ITSELF (red team, 2026-09-21). Apply commits it BEFORE reconcile runs, so
 *   a deploy killed before the claim — an upstream that failed, a Ctrl-C — leaves a row whose create
 *   never asked whose object sat at its identity. 🔴 MEASURED (openbao/adopt-holes.test.ts): with the
 *   name an Output, the next deploy "resumed" that create and wrote over another owner's role, in
 *   every family that had a note on the row alone. So the note is left only when the family's own
 *   `read`, asked as the recovery read (probe.ts ownedRead: a recorded instance, a row carrying the
 *   whole declaration, and a live object that matches it), answers "ours". For a `creating` row
 *   that is the question Plan.ts already asked; for a `replacing` row it is the only time it is asked.
 * ⚠️ WHY NOT THE STATE STORE ALONE. At reconcile both look the same: Apply commits the fresh create's
 *   `creating` row before calling reconcile, so a row with this instance id is always there.
 * ★ THE CHANNEL IS ALCHEMY'S OWN: `Artifacts`, the per-FQN bag the engine shares between one plan
 *   and its apply (Artifacts.ts: "diff computes … create / update reads the same artifact").
 *   Deploy.ts and the Alchemist session both hold one store across the pair.
 * ⚠️ IT FAILS CLOSED. No bag, a bag the plan never wrote, or an object the read cannot prove ours
 *   reads as a fresh create, and adopt.ts then asks for `--adopt` — the safe direction.
 * ★ AN UNPROVEN RESUME IS STILL MARKED UNFINISHED (`noteUnfinished`), so `--adopt` can take it over
 *   the way Alchemy's own "Cannot resume creating … Re-run with --adopt" offers for a create — while
 *   a FRESH replace's new generation, which no diff ever saw without attributes, stays unadoptable.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { Artifacts } from 'alchemy/Artifacts';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

const PROVEN = 'homeflare/ownership/resumes';
const UNFINISHED = 'homeflare/ownership/unfinished';

const note = (key: string, instanceId: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const bag = yield* Effect.serviceOption(Artifacts);
    if (Option.isSome(bag)) yield* bag.value.set(key, instanceId);
  });

const noted = (key: string, instanceId: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const bag = yield* Effect.serviceOption(Artifacts);
    if (Option.isNone(bag)) return false;
    return (yield* bag.value.get<string>(key)) === instanceId;
  });

/**
 * `diff`'s note for a row with no attributes: `instanceId` is an unfinished generation of this
 * resource's own, which `--adopt` may resume when nothing proves it (adopt.ts adoptable). Returns
 * `undefined`, a diff's "defer to the engine".
 */
export const noteUnfinished = (instanceId: string): Effect.Effect<undefined> =>
  Effect.as(note(UNFINISHED, instanceId), undefined);

/**
 * Note `instanceId` unfinished, and a proven resume when `recovered` — the family's `read` of the
 * row's props, asked with no attributes — answers a plain object: ours. `Unowned`, nothing, or a
 * read that fails or dies proves nothing. ⚠️ Never fails the plan: an unproven resume is refused
 * at apply instead, unless `--adopt`.
 */
export const noteResume = <R>(
  instanceId: string,
  recovered: Effect.Effect<unknown, unknown, R>,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    yield* noteUnfinished(instanceId);
    const unproven = () => Effect.succeed(undefined);
    const found = yield* recovered.pipe(Effect.catch(unproven), Effect.catchDefect(unproven));
    if (found === undefined || found === null || Unowned.is(found)) return;
    yield* note(PROVEN, instanceId);
  });

/** Whether the plan for this apply noted `instanceId` as a proven resumed create or replace. */
export const resumes = (instanceId: string): Effect.Effect<boolean> => noted(PROVEN, instanceId);

/** Whether the plan for this apply saw `instanceId` as an unfinished generation (proven or not). */
export const unfinished = (instanceId: string): Effect.Effect<boolean> =>
  noted(UNFINISHED, instanceId);

/** The fields of a `read` or `diff` call provingResumes uses; a family's own input carries more. */
type Ask = {
  readonly id: string;
  readonly fqn: string;
  readonly instanceId: string;
  readonly olds: unknown;
  readonly output: unknown;
};
type Hook = Effect.Effect<unknown, unknown, unknown>;

/** The two hooks provingResumes wraps, as Alchemy's ProviderService declares them. */
interface Resumable {
  read?(input: Ask): Hook;
  diff?(input: Ask): Hook;
}

/**
 * A provider whose `diff`, for a row with no attributes, first asks the provider's own `read` whether
 * the live object is that unfinished generation's (noteResume), then runs as written. Every Bao.*
 * family is built through it, so their diffs answer such a row with a plain `undefined`.
 */
export const provingResumes = <S extends Resumable>(service: S): S => {
  const { diff, read } = service;
  if (diff === undefined || read === undefined) return service;
  const proving: Resumable['diff'] = (input) =>
    Effect.gen(function* () {
      if (input.output === undefined) {
        yield* noteResume(input.instanceId, read({ ...input, output: undefined }));
      }
      return yield* diff(input);
    });
  // ⚠️ The one cast: `diff` keeps the family's own signature — it is the family's diff, run after.
  return { ...service, diff: proving } as S;
};
