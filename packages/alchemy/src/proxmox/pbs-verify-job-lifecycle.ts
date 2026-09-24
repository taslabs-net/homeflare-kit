/** PBS 4.2.6-1 verify lifecycle; the SDK owns serialization and typed API errors. */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import { specGuards } from './resource-guard.ts';
import type { PbsVerifyJobAttributes, PbsVerifyJobProps } from './pbs-verify-job.ts';
import { spec } from './pbs-verify-job-spec.ts';
import { createOne, deleteOne, readOne, updateOne } from './pbs-verify-job-wire.ts';

const { guardCreate, guardUpdate } = specGuards(spec);

export const handlers = {
  // ⛔ Explicit adoption only: a listed job may be somebody else's only backup policy.
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: PbsVerifyJobProps }) => readOne(olds),
  diff: ({
    news,
    output,
  }: {
    news: Input<PbsVerifyJobProps>;
    output: PbsVerifyJobAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* guardCreate(news, output === undefined);
      yield* guardUpdate(news);
      if (output === undefined) return undefined;
      const live = yield* readOne(news);
      if (live === undefined) {
        yield* guardCreate(news, true);
        return { action: 'update' } as const;
      }
      return { action: spec.matches(live, news) ? 'noop' : 'update' } as const;
    }),
  reconcile: ({ news }: { news: PbsVerifyJobProps }) =>
    Effect.gen(function* () {
      const live = yield* readOne(news);
      yield* guardCreate(news, live === undefined);
      yield* guardUpdate(news);
      if (live === undefined) yield* createOne(news);
      else if (!spec.matches(live, news)) yield* updateOne(news);
      // ⛔ A successful write is not evidence of a job; read it back through the SDK.
      const after = yield* readOne(news);
      if (after === undefined) {
        return yield* Effect.fail(
          new Error(`${spec.path(news)}: write succeeded but job is absent.`),
        );
      }
      return after;
    }),
  delete: ({ olds }: { olds: PbsVerifyJobProps }) => deleteOne(olds),
};
