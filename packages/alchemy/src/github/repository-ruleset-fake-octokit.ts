/**
 * Two `RulesetOctokit` fakes for the test files — no HTTP, no Octokit instance, exactly the
 * seam repository-ruleset-probe.ts documents. Mirrors `postgres/fake-sql.ts`'s split: a
 * GET-only fake that refuses to be written to (proves a plan touches nothing when it should
 * not), and a write-recording fake that behaves like a tiny in-memory GitHub, so the SAME
 * `reconcileRuleset` code under test runs against both.
 */
import * as Effect from 'effect/Effect';
import type { CreateRulesetBody } from './repository-ruleset-constraints.ts';
import type { RulesetOctokit, RulesetRecord, RulesetSummary } from './repository-ruleset-probe.ts';

const refuseWrite = (op: string) => () =>
  Effect.fail(new Error(`GET-only fake: ${op} must never be called`));

/** Serves a fixed `{repo: RulesetRecord}` map and fails any write — for tests that must prove
 * a plan is a pure read (a noop, or a refusal caught before any write). */
export function makeGetOnlyFake(byRepo: Readonly<Record<string, RulesetRecord>>): RulesetOctokit {
  return {
    list: ({ repo }) =>
      Effect.succeed(
        byRepo[repo] === undefined
          ? []
          : ([
              {
                id: byRepo[repo].id,
                name: byRepo[repo].name,
                target: byRepo[repo].target,
                source_type: byRepo[repo].source_type,
              },
            ] satisfies RulesetSummary[]),
      ),
    get: ({ repo, rulesetId }) =>
      Effect.succeed(byRepo[repo]?.id === rulesetId ? byRepo[repo] : undefined),
    create: refuseWrite('create'),
    update: refuseWrite('update'),
    delete: refuseWrite('delete'),
    hasContextReportedSuccess: () => Effect.succeed(true),
  };
}

export interface RecordedWrite {
  readonly op: 'create' | 'update' | 'delete';
  readonly repo: string;
  readonly body?: CreateRulesetBody;
}

export interface RecordingFake {
  readonly octokit: RulesetOctokit;
  readonly writes: RecordedWrite[];
  /** Whether `hasContextReportedSuccess` answers `true` — defaults to `true` (every context
   * has reported); set per-context to test `NeverReportedContext`. */
  readonly reportedContexts: Set<string>;
}

let nextId = 90000;

/** An in-memory GitHub: `create` assigns an id and stores the record verbatim (merging the
 * REQUEST body, not re-deriving it, so a test can inspect exactly what reconcile sent);
 * `update` replaces the stored rules/enforcement/etc from the body; every write is also
 * appended to `writes` for direct assertions ("N changed values give N non-noop results" is
 * checked by counting entries here, not by re-reading state). */
export function makeRecordingFake(initial: Readonly<Record<string, RulesetRecord>>): RecordingFake {
  const state = new Map<string, RulesetRecord>(Object.entries(initial));
  const writes: RecordedWrite[] = [];
  const reportedContexts = new Set<string>();

  const octokit: RulesetOctokit = {
    list: ({ repo }) => {
      const record = state.get(repo);
      return Effect.succeed(
        record === undefined
          ? []
          : ([
              {
                id: record.id,
                name: record.name,
                target: record.target,
                source_type: record.source_type,
              },
            ] satisfies RulesetSummary[]),
      );
    },
    get: ({ repo, rulesetId }) => {
      const record = state.get(repo);
      return Effect.succeed(record?.id === rulesetId ? record : undefined);
    },
    create: ({ repo, body }) =>
      Effect.sync(() => {
        const id = nextId++;
        const record: RulesetRecord = {
          id,
          name: body.name,
          target: body.target ?? 'branch',
          source_type: 'Repository',
          enforcement: body.enforcement,
          bypass_actors: body.bypass_actors,
          conditions: body.conditions,
          rules: body.rules as unknown as Record<string, unknown>[],
        };
        state.set(repo, record);
        writes.push({ op: 'create', repo, body });
        return record;
      }),
    update: ({ repo, rulesetId, body }) =>
      Effect.sync(() => {
        const existing = state.get(repo);
        const record: RulesetRecord = {
          id: rulesetId,
          name: body.name,
          target: body.target ?? 'branch',
          source_type: 'Repository',
          enforcement: body.enforcement,
          bypass_actors: body.bypass_actors,
          conditions: body.conditions,
          rules: body.rules as unknown as Record<string, unknown>[],
          created_at: existing?.created_at,
        };
        state.set(repo, record);
        writes.push({ op: 'update', repo, body });
        return record;
      }),
    delete: ({ repo, rulesetId }) =>
      Effect.sync(() => {
        if (state.get(repo)?.id === rulesetId) state.delete(repo);
        writes.push({ op: 'delete', repo });
      }),
    hasContextReportedSuccess: ({ context }) => Effect.succeed(reportedContexts.has(context)),
  };

  return { octokit, writes, reportedContexts };
}
