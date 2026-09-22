/**
 * `@homeflare/alchemy/verify` — prove a deploy's adoptions are no-ops before it runs.
 *
 * ★ ONE TOOL FOR EVERY STACK, NOT A TEST PER REPO. A stack runs `hf-adopt-verify --config
 *   alchemy.run.ts --stage live` before a gated deploy, or calls `verifyStack` from its own
 *   script; both plan with Alchemy's planner and never write. docs/adopt-verify.md has the why,
 *   the report's columns, and what each kit family does on an adopted deploy.
 * ⛔ A SUBPATH OF ITS OWN: it imports the stack module from disk and reads the state store, which
 *   is host access, so it never rides along with the runtime-neutral root entry.
 */
export { type Parsed, USAGE, parseVerifyArgs } from './args.ts';
export { exitCodeOf, formatReport } from './report.ts';
export {
  type AdoptRow,
  type NodeView,
  type PlanView,
  type TaskView,
  changedFields,
  rowsOf,
} from './rows.ts';
export {
  type DiffAnswer,
  type Observations,
  type ReadAnswer,
  type RecheckAnswer,
  type Seen,
  WRITE_REFUSED,
  spyContext,
} from './spy.ts';
export {
  type AdoptReport,
  type VerifyOptions,
  type VerifySession,
  type VerifyTarget,
  verifySession,
  verifyStack,
} from './verify.ts';
