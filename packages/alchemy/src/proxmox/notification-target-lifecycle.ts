/** PVE targets: observe before writes, retain secret omission and built-in delete behavior. */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import type {
  NotificationTargetAttributes as Attributes,
  NotificationTargetProps as Props,
} from './notification-target.ts';
import { specGuards } from './resource-guard.ts';
import { targetSpec } from './notification-target-spec.ts';
import {
  createTarget,
  deleteTarget,
  readTarget,
  updateTarget,
} from './notification-target-distilled.ts';

const { guardCreate, guardUpdate } = specGuards(targetSpec);
const guard = (props: Props, create: boolean) =>
  guardCreate(props, create).pipe(Effect.andThen(guardUpdate(props)));
export const targetHandlers = {
  /** Targets include built-ins and human-owned endpoints; enrollment remains explicit. */
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: Props }) =>
    Effect.gen(function* () {
      const live = yield* readTarget(olds);
      yield* guard(olds, live === undefined);
      return live;
    }),
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
      if (!isResolved(news)) return undefined;
      // Names are unique across endpoint types. A same-name type change must delete first.
      if (olds.name !== news.name || olds.type !== news.type)
        return { action: 'replace', deleteFirst: olds.name === news.name } as const;
      yield* guard(news, output === undefined);
      if (output === undefined) return undefined;
      const live = yield* readTarget(news);
      if (live === undefined) {
        yield* guard(news, true);
        return { action: 'update' } as const;
      }
      return { action: targetSpec.matches(live, news) ? 'noop' : 'update' } as const;
    }),
  reconcile: ({ news }: { news: Props }) =>
    Effect.gen(function* () {
      const live = yield* readTarget(news);
      yield* guard(news, live === undefined);
      if (live === undefined) yield* createTarget(news);
      else if (!targetSpec.matches(live, news)) yield* updateTarget(news);
      const after = yield* readTarget(news);
      if (after === undefined)
        return yield* Effect.die(
          new Error(`Notification target ${news.name}: write returned but read-back is absent.`),
        );
      return after;
    }),
  /** Vendor DELETE reverts built-ins; SDK NotFound makes an absent custom target idempotent. */
  delete: ({ olds }: { olds: Props }) => deleteTarget(olds),
};
