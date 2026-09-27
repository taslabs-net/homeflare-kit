/** Named SDK transport; pve-manager 9.2.11 ReplicationConfig.pm defines absence and removal. */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as cluster from '@distilled.cloud/proxmox/cluster';
import { ProxmoxParseError } from '@distilled.cloud/proxmox/Errors';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { runPve } from './distilled-pve.ts';
import type { ReplicationJobAttributes, ReplicationJobProps } from './replication-job.ts';
import { replicationJobSpec as spec } from './replication-job-config.ts';
import { jobId } from './replication-job-form.ts';
import { specGuards } from './resource-guard.ts';
import { formToSend } from './update-guard.ts';
import { int } from './values.ts';

const { guardCreate, guardUpdate } = specGuards(spec);
const malformed = () =>
  new ProxmoxParseError({
    body: undefined,
    cause: 'Replication job response does not match the requested vendor identity',
  });

export const readReplicationJob = (props: ReplicationJobProps) =>
  runPve(props.target, 'read', false, cluster.getClusterReplication({ id: jobId(props) })).pipe(
    Effect.flatMap((live) =>
      // ⚠️ SectionConfig releases can echo `guest`/`jobnum` (and `rate`) as text rather than a JSON
      //   number — measured on replication-job-config.ts's own `int()`/`rateOf()` fields, which is
      //   why every other numeric read in this family goes through `int()` rather than a strict
      //   type. `GetClusterReplicationResponse` types `guest`/`jobnum` as `S.Number` with no
      //   coercion, so a string echo fails decode before the identity check below ever runs;
      //   normalize both through `int()` first, same as `rate` is normalized to skip its own
      //   release-dependent shape.
      Schema.decodeUnknownEffect(Schema.toType(cluster.GetClusterReplicationResponse))({
        ...live,
        guest: int(live.guest, Number.NaN),
        jobnum: int(live.jobnum, Number.NaN),
        rate: undefined,
      }).pipe(Effect.mapError(malformed), Effect.as(live)),
    ),
    Effect.flatMap((live) =>
      // ⛔ `id` alone (a string PVE always returns, e.g. "900-0") already proves identity; the
      //   guest/jobnum recheck is defense in depth, so it must tolerate the same string-or-number
      //   wire shape as the decode above rather than `===` against the raw, possibly-text value.
      live.id === jobId(props) &&
      int(live.guest, Number.NaN) === props.guest &&
      int(live.jobnum, Number.NaN) === props.jobnum
        ? Effect.succeed(spec.attributes({ ...live }, props))
        : Effect.fail(malformed()),
    ),
    Effect.catchTag('ReplicationJobNotFound', () => Effect.succeed(undefined)),
  );

/** DELETE without force/keep marks full background removal; it must never force immediate removal. */
export const deleteReplicationJob = (props: ReplicationJobProps) =>
  runPve(
    props.target,
    'provision',
    true,
    cluster.deleteClusterReplication({ id: jobId(props) }),
  ).pipe(Effect.catchTag('ReplicationJobNotFound', () => Effect.void));

export const replicationJobHandlers = {
  // Explicit declaration is the only way to adopt a job and gain deletion authority over replicas.
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: ReplicationJobProps }) => readReplicationJob(olds),
  diff: Effect.fn(function* ({
    news,
    output,
  }: {
    news: Input<ReplicationJobProps>;
    output: ReplicationJobAttributes | undefined;
  }) {
    if (!isResolved(news)) return undefined;
    yield* guardCreate(news, output === undefined);
    yield* guardUpdate(news);
    if (output === undefined) return undefined;
    const live = yield* readReplicationJob(news);
    if (live === undefined) {
      yield* guardCreate(news, true);
      return { action: 'update' } as const;
    }
    return { action: spec.matches(live, news) ? 'noop' : 'update' } as const;
  }),
  reconcile: Effect.fn(function* ({ news }: { news: ReplicationJobProps }) {
    const live = yield* readReplicationJob(news);
    yield* guardCreate(news, live === undefined);
    yield* guardUpdate(news);
    if (live === undefined) {
      yield* runPve(
        news.target,
        'provision',
        true,
        cluster.createClusterReplication(spec.createForm(news)),
      );
    } else {
      const form = formToSend(spec.matches, live, news, spec.updateForm(news));
      if (form !== undefined)
        yield* runPve(
          news.target,
          'provision',
          true,
          cluster.putClusterReplication({ ...form, id: jobId(news) }),
        );
    }
    const after = yield* readReplicationJob(news);
    if (after === undefined)
      return yield* Effect.fail(
        new Error(`${spec.path(news)}: write returned success but the resource is still absent`),
      );
    return after;
  }),
  delete: ({ olds }: { olds: ReplicationJobProps }) => deleteReplicationJob(olds),
};
