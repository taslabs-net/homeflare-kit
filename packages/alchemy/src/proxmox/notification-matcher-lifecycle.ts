/** A matching PVE matcher adoption writes nothing; unreadable is never treated as absent. */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import type { NotificationMatcherProps as Props } from './notification-matcher.ts';
import {
  type NotificationMatcherAttributes as Attributes,
  matcherCreateForm,
  matcherMatches,
  matcherUpdateForm,
} from './notification-matcher-form.ts';
import { guardForm } from './constraint-guard.ts';
import {
  createMatcher,
  deleteMatcher,
  readMatcher,
  updateMatcher,
} from './notification-matcher-distilled.ts';

const guard = (props: Props, create: boolean) =>
  guardForm('pve:POST /cluster/notifications/matchers', matcherCreateForm(props), create).pipe(
    Effect.andThen(
      guardForm('pve:PUT /cluster/notifications/matchers/{name}', matcherUpdateForm(props), false),
    ),
  );

export const matcherHandlers = {
  /** Built-ins and human-created matchers are not auto-enrolled; adoption is explicit. */
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: Props }) =>
    Effect.gen(function* () {
      const live = yield* readMatcher(olds);
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
      if (olds.name !== news.name) return { action: 'replace' } as const;
      yield* guard(news, output === undefined);
      if (output === undefined) return undefined;
      const live = yield* readMatcher(news);
      if (live === undefined) {
        yield* guard(news, true);
        return { action: 'update' } as const;
      }
      return { action: matcherMatches(live, news) ? 'noop' : 'update' } as const;
    }),
  reconcile: ({ news }: { news: Props }) =>
    Effect.gen(function* () {
      const live = yield* readMatcher(news);
      yield* guard(news, live === undefined);
      if (live === undefined) yield* createMatcher(news);
      else if (!matcherMatches(live, news)) yield* updateMatcher(news);
      const after = yield* readMatcher(news);
      if (after === undefined)
        return yield* Effect.die(
          new Error(`Notification matcher ${news.name}: write returned but read-back is absent.`),
        );
      return after;
    }),
  delete: ({ olds }: { olds: Props }) => deleteMatcher(olds),
};
