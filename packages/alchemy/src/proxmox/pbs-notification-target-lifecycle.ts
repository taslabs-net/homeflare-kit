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
import { pve } from './client.ts';
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
import { targetAttributes } from './pbs-notification-target-wire.ts';
import { seal } from './write-only.ts';

type Props = PbsNotificationTargetProps;
type Attributes = PbsNotificationTargetAttributes;

const path = (props: Props) => `config/notifications/endpoints/${props.type}/${props.name}`;

/**
 * ⚠️ A 404 and `{"data": null}` are answers here — and so, resource.ts's ⛔, is a 403. `pve()`
 *   returns `null` for the second, not `undefined`, so the test is `== null`.
 */
const readLive = (props: Props) =>
  pve<Record<string, unknown>>(props.target, 'read', 'GET', path(props)).pipe(
    Effect.map((data) => (data == null ? undefined : targetAttributes(data, props))),
    Effect.orElseSucceed(() => undefined),
  );

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
  read: ({ olds, output }: { olds: Props; output: Attributes | undefined }) =>
    readLive(olds).pipe(
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
      if (olds !== undefined && (olds.type !== news.type || olds.name !== news.name)) {
        return { action: 'replace', deleteFirst: olds.name === news.name } as const;
      }
      yield* refuse(news);
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
        const collection = `config/notifications/endpoints/${news.type}`;
        yield* pve(
          news.target,
          'provision',
          'POST',
          collection,
          targetForm(news, groups, carry, 'create'),
        );
        sealed = seal(groups.sealed.values);
      } else {
        const carry = toCarry(live, news, groups, sealed);
        if (carry !== undefined) {
          yield* requireValues(news, groups, carry);
          yield* pve(
            news.target,
            'provision',
            'PUT',
            path(news),
            targetForm(news, groups, carry, 'update'),
          );
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
  delete: ({ olds }: { olds: Props }) => pve(olds.target, 'provision', 'DELETE', path(olds)),
};
