/**
 * One report row per planned resource: what the engine planned, what the provider said, and
 * whether that adds up to "this deploy leaves the object alone".
 *
 * ★ PURE, SO THE VERDICT IS TESTABLE WITHOUT AN ENGINE. verify.ts gathers the three inputs — the
 *   plan, which FQNs have a state row, and what the watched providers answered (spy.ts) — and
 *   this file only decides.
 */
import { deepEqual, isResolved } from 'alchemy/Diff';
import type { DiffAnswer, Observations, ReadAnswer, RecheckAnswer } from './spy.ts';

export interface AdoptRow {
  readonly fqn: string;
  readonly type: string;
  /**
   * Whether the row plans from a row the state store holds for it (verify.ts `withState`). An
   * adoption is a row without one.
   */
  readonly stateRow: boolean;
  /** The engine's action — what `alchemy plan` prints (`adopted`, `create`, `noop`, …). */
  readonly planned: string;
  /** What the provider's `read` answered, or `not-read` when nothing asked it. */
  readonly read: ReadAnswer;
  /** What the provider's own `diff` answered BEFORE Plan.ts forced it (spy.ts). */
  readonly diff: DiffAnswer;
  /**
   * Declared fields whose live value differs, by NAME only — values can be secrets. Compared on
   * same-named keys of the declaration and the read's attributes, so a family whose attributes
   * rename a field cannot show it here. The diff answer is the verdict; a name here beside an
   * adopted `noop` only makes recheck.ts ask that diff again.
   */
  readonly changed: readonly string[];
  /**
   * What the provider's `diff` answered when asked again with the live values of `changed` as its
   * recorded props (recheck.ts). Absent when it was not asked: only an adopted `noop` with
   * something in `changed` is.
   */
  readonly recheck?: RecheckAnswer;
  /** Bindings the engine will create, update or delete — reconcile applies them even on `noop`. */
  readonly bindings: number;
  readonly ok: boolean;
  /** Why the row is not a no-op, or a note on one that is; empty when there is nothing to say. */
  readonly why: string;
}

/** The slice of an Alchemy plan node this file reads. */
export interface NodeView {
  readonly action: string;
  readonly resource: { readonly Type: string };
  readonly bindings?: readonly { readonly action: string }[];
}

/** A stack task (an Alchemy action): `run`, `noop` or `delete`. It has no provider to ask. */
export interface TaskView {
  readonly action: string;
  readonly def: { readonly Type: string };
}

/** The slice of an Alchemy `Plan` this file reads. */
export interface PlanView {
  readonly resources: Readonly<Record<string, NodeView>>;
  readonly deletions: Readonly<Record<string, NodeView | undefined>>;
  readonly actions?: Readonly<Record<string, TaskView | undefined>>;
}

/** Same-named, declared, resolved fields where the live value differs. */
export const changedFields = (declared: unknown, live: unknown): string[] => {
  if (typeof declared !== 'object' || declared === null) return [];
  if (typeof live !== 'object' || live === null) return [];
  const actual = live as Record<string, unknown>;
  return Object.entries(declared as Record<string, unknown>)
    .filter(([key, value]) => value !== undefined && key in actual && isResolved(value))
    .filter(([key, value]) => !deepEqual(value, actual[key]))
    .map(([key]) => key)
    .sort();
};

const STILL_LIVE = new Set(['adopted', 'noop']);

/**
 * ⛔ `adopted` NEEDS THE PROVIDER'S OWN `noop`. With no diff (`none`) the engine compared the
 *   declaration with the declaration — an adopted row's state carries `props: news` (Plan.ts) — so
 *   its noop proves nothing. A row with state is different: there the engine compared against the
 *   props it last deployed, which is the same check `alchemy plan` makes.
 */
const isNoop = (planned: string, diff: DiffAnswer, stateRow: boolean) =>
  STILL_LIVE.has(planned) &&
  (diff === 'noop' || (diff === 'none' && stateRow && planned === 'noop'));

/**
 * ⛔ AND A `noop` MUST SURVIVE BEING ASKED WITH THE LIVE VALUES. A diff that compares recorded props
 *   answers an adopted row `noop` whatever the cloud holds; recheck.ts asks it again, and only a
 *   second `noop` (or no need to ask) proves anything.
 */
const proven = (recheck: RecheckAnswer | undefined) => recheck === undefined || recheck === 'noop';

/** Notes on a row that passes: nothing to say is the common case. */
const notes = (row: Omit<AdoptRow, 'ok' | 'why'>): string =>
  [
    row.read === 'unowned' ? 'unowned: the deploy needs --adopt or adopt(true)' : '',
    row.recheck === 'noop'
      ? `${row.changed.join(', ')} differ, but the diff says noop even given the live values: ` +
        'the family does not manage them, and the deploy leaves them alone'
      : '',
  ]
    .filter((note) => note !== '')
    .join('; ');

const reason = (row: Omit<AdoptRow, 'ok' | 'why'>, ok: boolean): string => {
  if (ok) return notes(row);
  if (isNoop(row.planned, row.diff, row.stateRow)) {
    const live = `the live ${row.changed.join(', ')}`;
    if (row.recheck === 'failed') {
      return `asked again with ${live} as recorded props, the provider's diff failed: not proven`;
    }
    if (!proven(row.recheck)) {
      return (
        `the provider's diff compares recorded props, not the live object: given ${live} it ` +
        `says ${String(row.recheck)}, and the deploy's forced reconcile writes`
      );
    }
    return `${String(row.bindings)} binding(s) change: the deploy reconciles them though the diff is noop`;
  }
  if (row.planned === 'delete') return 'no longer declared: the deploy deletes it';
  if (row.planned === 'orphaned') return 'no longer declared: the deploy drops its state (retain)';
  if (row.read === 'failed') return "the verifier's own read of it failed";
  if (row.planned === 'create') {
    if (row.stateRow) return 'an interrupted create: the deploy finishes creating it';
    return row.read === 'absent'
      ? 'the read found nothing, so the deploy CREATES it (a lane that cannot see it reads the same)'
      : 'never probed (a prop is an Output of another resource, or the provider has no read): ' +
          'the deploy CREATES it';
  }
  if (row.diff === 'update') return "the provider's diff says update: the deploy writes";
  if (row.diff === 'replace') return "the provider's diff says replace: a new one, then a delete";
  if (row.diff === 'none') {
    return 'the provider has no diff, so the engine compared the declaration with itself';
  }
  return `the engine plans ${row.planned} although the diff says ${row.diff} (a renamed row, changed bindings or --force)`;
};

export const rowFor = (
  fqn: string,
  node: NodeView,
  stateRow: boolean,
  seen: Observations,
): AdoptRow => {
  const observed = seen.get(fqn);
  const recheck = observed?.recheck;
  const base = {
    bindings: (node.bindings ?? []).filter((binding) => binding.action !== 'noop').length,
    changed: changedFields(observed?.diff?.news, observed?.read?.attributes),
    diff: observed?.diff?.answer ?? 'not-run',
    fqn,
    planned: node.action,
    read: observed?.read?.answer ?? 'not-read',
    ...(recheck === undefined ? {} : { recheck }),
    stateRow,
    type: node.resource.Type,
  } satisfies Omit<AdoptRow, 'ok' | 'why'>;
  /**
   * ⚠️ A NOOP DIFF DOES NOT COVER BINDINGS. Plan.ts diffs them separately and hands every
   *   non-noop binding to `reconcile`, which an adopted row reaches anyway — a Worker adopted with
   *   a new binding writes although its own diff said nothing changed.
   */
  const ok = isNoop(base.planned, base.diff, stateRow) && proven(recheck) && base.bindings === 0;
  return { ...base, ok, why: reason(base, ok) };
};

/**
 * ⚠️ A TASK THAT RUNS IS A WRITE THE PROVIDERS NEVER SEE, so it is reported in both modes; a task
 *   that would not run appears only with `all`.
 */
const taskRow = (fqn: string, task: TaskView): AdoptRow => ({
  bindings: 0,
  changed: [],
  diff: 'not-run',
  fqn,
  ok: task.action === 'noop',
  planned: task.action,
  read: 'not-read',
  stateRow: task.action !== 'run',
  type: task.def.Type,
  why: task.action === 'noop' ? '' : `a stack task: the deploy will ${task.action} it`,
});

/**
 * The rows to report. Without `all`, only rows WITHOUT a state row — the adoptions and creates a
 * deploy would perform — which is the question this tool exists for, plus any task that runs. With
 * `all`, every declared row, every pending deletion and every task.
 */
export const rowsOf = (
  plan: PlanView,
  stateRows: ReadonlySet<string>,
  seen: Observations,
  all: boolean,
): AdoptRow[] => {
  const declared = Object.entries(plan.resources)
    .filter(([fqn]) => all || !stateRows.has(fqn))
    .map(([fqn, node]) => rowFor(fqn, node, stateRows.has(fqn), seen));
  const removed = all
    ? Object.entries(plan.deletions).flatMap(([fqn, node]) =>
        node === undefined ? [] : [rowFor(fqn, node, true, seen)],
      )
    : [];
  const tasks = Object.entries(plan.actions ?? {}).flatMap(([fqn, task]) =>
    task === undefined || (!all && task.action === 'noop') ? [] : [taskRow(fqn, task)],
  );
  return [...declared, ...removed, ...tasks].sort((a, b) => a.fqn.localeCompare(b.fqn));
};
