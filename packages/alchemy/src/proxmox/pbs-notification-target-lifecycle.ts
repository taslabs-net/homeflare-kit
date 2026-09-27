/**
 * The lifecycle of a `Pbs.NotificationTarget`: read, diff, reconcile, delete.
 *
 * ★ SPLIT OUT OF pbs-notification-target.ts FOR THE 250-LINE CAP. That file says what a target is
 *   and holds `Provider.of`; this one says what each operation does. The `import type` back is
 *   erased, so the cycle is on paper only.
 *
 * ⚠️ NOT `pveHandlers`, AND IT SHOULD LOOK DIFFERENT (resource.ts asks for exactly that). The
 *   factory's `diff` sees only the live object, and a secret's value is not in the live object:
 *   the seal lives in the PREVIOUS STATE, which only a hand-written `diff` and `reconcile` receive
 *   (`output`). Everything else — the read, the read-back refusal, the `matches` guard that keeps
 *   adoption free — is the factory's behaviour, written out.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import {
  createTarget,
  deleteTarget,
  readTarget as readLive,
  updateTarget,
  validateTargetWrite,
} from './pbs-notification-target-distilled.ts';
import { guardForm } from './constraint-guard.ts';
import { pbsTargetEndpoint } from './pbs-notification-target-endpoint.ts';
import type {
  PbsNotificationTargetAttributes,
  PbsNotificationTargetProps,
} from './pbs-notification-target.ts';
import {
  type Carry,
  type Groups,
  headerState,
  plainMatches,
  refusals,
  resolveGroups,
  sealedState,
  targetForm,
} from './pbs-notification-target-form.ts';
import { seal } from '../secrets/write-only.ts';

type Props = PbsNotificationTargetProps;
type Attributes = PbsNotificationTargetAttributes;

const path = (props: Props) => `config/notifications/endpoints/${props.type}/${props.name}`;

const refuse = (props: Props) => {
  const reasons = refusals(props);
  return reasons.length === 0
    ? Effect.void
    : Effect.die(new Error(`${path(props)}: ${reasons.join('; ')}.`));
};

/** What a write must carry, given what is stale. `undefined` means nothing to write. */
const toCarry = (live: Attributes, props: Props, groups: Groups, sealed: string) => {
  const header = headerState(live, props, groups) === 'stale';
  const sealedStale = sealedState(live, props, groups, sealed) === 'stale';
  return plainMatches(live, props) && !header && !sealedStale
    ? undefined
    : ({ header, sealed: sealedStale } satisfies Carry);
};

/** ⛔ Every variable a carried group needs, or a failure naming the missing ones — never a value. */
const requireValues = (props: Props, groups: Groups, carry: Carry) => {
  const missing = [
    ...(carry.header ? groups.header.missing : []),
    ...(carry.sealed ? groups.sealed.missing : []),
  ];
  return missing.length === 0
    ? Effect.void
    : Effect.die(
        new Error(
          `${path(props)}: this write must send write-only values, and ${missing.join(', ')} ` +
            'is unset or empty in the deploying environment. Export it and deploy again.',
        ),
      );
};

export const handlers = {
  /** ⛔ EMPTY: `mail-to-root` is on every host, and adoption stays an explicit act (resource.ts). */
  list: () => Effect.succeed([]),
  /**
   * ⛔ WITH NO `output` THIS IS ALCHEMY'S ADOPTION PROBE, AND THE ONLY PLAN-TIME HOOK A NEW TARGET
   *   GETS — so the refusals run here too. Measured on beta.79 (Plan.ts, the `oldState ===
   *   undefined` branch): a declaration with no state row is `read` with `olds: news` and never
   *   `diff`ed, and Apply then commits its props as `creating` BEFORE `reconcile` runs. A refusal
   *   left to `reconcile` fired after the props — a literal token included — were in the store.
   * ⚠️ ONLY WHEN THE PROPS ARE RESOLVED: Plan skips the probe while any prop is an unresolved
   *   Output, and then `reconcile` is the first check. docs/pbs-notifications.md says so.
   * ★ A DEFECT (`Effect.die`), NOT A FAILURE, AND THAT IS WHAT KEEPS IT FROM WEDGING A STAGE. The
   *   same `read`-with-no-output shape is Alchemy's RECOVERY read of an interrupted create, at plan
   *   and before a delete (Plan.ts, Apply.ts), with the STORED props — and both wrap it in
   *   `catchDefect`, degrading to "nothing recovered". A typed failure would pass that catch and
   *   block the plan or the delete on props the user already fixed. The cold-start probe has no
   *   catch, so there the defect fails the plan, as intended. A refused create sent no request,
   *   so "nothing recovered" is also the truth.
   */
  read: ({ olds, output }: { olds: Props; output: Attributes | undefined }) =>
    (output === undefined ? refuse(olds) : Effect.void).pipe(
      Effect.andThen(readLive(olds)),
      Effect.map((live) =>
        live === undefined ? undefined : { ...live, sealed: output?.sealed ?? '' },
      ),
    ),
  /**
   * ⚠️ `Input<Props>` and `isResolved`, resource.ts's reason: at plan time a prop can still be an
   *   unresolved Output, and comparing a placeholder to a live value reports a phantom update.
   * ⛔ A NEW `type` UNDER THE SAME `name` REPLACES DELETE-FIRST: names are unique across every
   *   family on the host (api `ensure_unique`), so creating the new one first would be refused.
   */
  diff: ({
    news,
    olds,
    output,
  }: {
    news: Input<Props>;
    olds: Props;
    output: Attributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (output === undefined || !isResolved(news)) return undefined;
      yield* refuse(news);
      if (olds !== undefined && (olds.type !== news.type || olds.name !== news.name)) {
        // ⛔ Preflight the destination before delete-first can remove a working target. A rename
        // may adopt an existing endpoint; its write-only values have no seal from this resource.
        const destination = yield* readLive(news);
        const groups = resolveGroups(news);
        const carry =
          destination === undefined
            ? { header: true, sealed: true }
            : toCarry(destination, news, groups, '');
        if (carry !== undefined) {
          yield* requireValues(news, groups, carry);
          const mode = destination === undefined ? 'create' : 'update';
          const form = targetForm(news, groups, carry, mode);
          yield* guardForm(pbsTargetEndpoint(news)[mode], form, destination === undefined);
          yield* validateTargetWrite(news, form, mode);
        }
        return { action: 'replace', deleteFirst: olds.name === news.name } as const;
      }
      const live = yield* readLive(news);
      if (live === undefined) return { action: 'update' } as const;
      return toCarry(live, news, resolveGroups(news), output.sealed) === undefined
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),
  reconcile: ({ news, output }: { news: Props; output: Attributes | undefined }) =>
    Effect.gen(function* () {
      yield* refuse(news);
      const groups = resolveGroups(news);
      const live = yield* readLive(news);
      let sealed = output?.sealed ?? '';
      if (live === undefined) {
        const carry = { header: true, sealed: true } as const;
        yield* requireValues(news, groups, carry);
        const form = targetForm(news, groups, carry, 'create');
        /**
         * ⛔ WITH PRESENCE, BECAUSE THIS BRANCH IS UNCONDITIONALLY THE CREATE. PBS marks `name` on
         *   every family and `server`/`from-address` on smtp, `url`/`method` on webhook — and it
         *   is the same `comment: maxLength 128` that failed `POST /config/verify`.
         * ⚠️ THE FORM CARRIES SECRETS ON THIS PATH. `violations` reads values and builds only the
         *   parameter NAME into its message (constraints.ts), so a refusal never quotes one.
         */
        yield* guardForm(pbsTargetEndpoint(news).create, form, true);
        yield* createTarget(news, form);
        sealed = seal(groups.sealed.values);
      } else {
        const carry = toCarry(live, news, groups, sealed);
        if (carry !== undefined) {
          yield* requireValues(news, groups, carry);
          const form = targetForm(news, groups, carry, 'update');
          /** ⚠️ NO PRESENCE: an update form is partial by design — it carries what `toCarry` said. */
          yield* guardForm(pbsTargetEndpoint(news).update, form, false);
          yield* updateTarget(news, form);
          if (carry.sealed) sealed = seal(groups.sealed.values);
        }
      }
      const after = yield* readLive(news);
      if (after === undefined) {
        // ⛔ resource.ts's rule: "no error" is not evidence of a write. Read back, or refuse.
        return yield* Effect.die(
          new Error(`${path(news)}: the write returned no error but the target is still absent.`),
        );
      }
      return { ...after, sealed } satisfies Attributes;
    }),
  delete: ({ olds }: { olds: Props }) => deleteTarget(olds),
};
