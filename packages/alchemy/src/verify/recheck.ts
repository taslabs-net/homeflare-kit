/**
 * Ask an adopted row's `diff` a second time, with the live values as its recorded props, when its
 * first `noop` sits beside a read that differs from the declaration.
 *
 * 🔴 WHY (red-teamed 2026-09-21). Plan.ts hands an adopted row's diff `olds: news`, because the
 *   adopted state carries `props: news`. A diff that compares the RECORDED props with the
 *   declaration therefore answers `noop` whatever the cloud holds, and the forced reconcile then
 *   writes. Alchemy's own `Cloudflare.R2Bucket` diff is that shape (beta.79
 *   Cloudflare/R2/Bucket.ts, `olds.domains` against `news.domains`). The verifier said `ok`,
 *   exited 0, and listed the drift under `changed` on the same line. rows.ts already refused to
 *   trust a MISSING diff for this reason; a diff that never looks at the live object is the same
 *   blind spot one level down.
 *
 * ★ THE QUESTION IS "WOULD YOU STILL SAY noop IF STATE HAD RECORDED WHAT THE READ FOUND?" It is the
 *   planner's own input, replayed with one change: `olds` carries the read's value for each field
 *   in `changed`. A diff that reads the live object ignores `olds` and answers as before. Every kit
 *   PVE/PBS family re-reads (`pveOperations.diff`), so a field its `matches` leaves out, such as
 *   CephPool's autoscaled `pg_num`, still passes. A diff that compares `olds` now sees the drift.
 *
 * ⛔ ONLY `diff`, a read by Alchemy's contract, and through the WATCHED provider, so every write
 *   path still answers with spy.ts's refusal. The first answer is put back afterwards: the report's
 *   `diff` column stays what the planner heard.
 * ⚠️ IT CAN ONLY TURN A PASS INTO A FAIL. It runs on a row that would otherwise pass (adopted,
 *   `noop`, something in `changed`), and anything but a second `noop`, a failure included, fails it.
 * ⚠️ SAME-NAMED FIELDS ONLY, like `changed`: a drift in a field whose attribute has another name is
 *   invisible to both. Whether a `reconcile` PUTs identical values anyway is still up to the
 *   provider (docs/adopt-verify.md, Limits).
 */
import type { ProviderService } from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { inPlanScope } from './plan-scope.ts';
import { changedFields } from './rows.ts';
import { type Observations, type RecheckAnswer, diffAnswer } from './spy.ts';

/** The plan-node fields a recheck needs. */
export interface RecheckNode {
  readonly action: string;
  readonly provider?: ProviderService;
  readonly state?: { readonly instanceId: string };
}

/** Recheck one planned row if it needs it; the answer lands in `seen` as `recheck`. */
export const recheck = (fqn: string, node: RecheckNode, seen: Observations): Effect.Effect<void> =>
  Effect.gen(function* () {
    const observed = seen.get(fqn);
    const first = observed?.diff;
    const input = first?.input;
    const diff = node.provider?.diff;
    if (node.action !== 'adopted' || first?.answer !== 'noop' || input === undefined) return;
    const live = observed?.read?.attributes as Record<string, unknown> | undefined;
    const changed = changedFields(input.news, live);
    if (live === undefined || changed.length === 0) return;
    if (diff === undefined || node.state === undefined) return;
    const olds = {
      ...(input.olds as object),
      ...Object.fromEntries(changed.map((key) => [key, live[key]])),
    };
    // ⚠️ THE CAST IS THE ENGINE'S BOUNDARY, as in verify.ts: the diff's requirements are the
    //   session's, which verifySession provides around this call.
    const asked = diff({ ...input, olds } as typeof input) as Effect.Effect<unknown>;
    const answer: RecheckAnswer = yield* asked.pipe(
      inPlanScope(fqn, node.state.instanceId),
      Effect.map(diffAnswer),
      Effect.catchCause(() => Effect.succeed('failed' as const)),
    );
    // The watched diff recorded the replay over the planner's answer; put the planner's back.
    if (observed !== undefined) {
      observed.diff = first;
      observed.recheck = answer;
    }
  });
