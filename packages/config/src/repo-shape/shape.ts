/**
 * `RepoShape` — one HomeFlare repository's tooling, as a value.
 *
 * ★ WHY THIS TYPE EXISTS. Measured across the estate on 2026-09-22: 13 repositories each
 *   carry a hand-written `.github/workflows/ci.yml`, `security.yml`, `.github/actionlint.yaml`
 *   and `.changeset/config.json`. The changeset configs were byte-identical apart from the
 *   repository name in 11 of 13. The security workflows were not: five still carried
 *   `push: branches: [main]` that the other eight had removed, five were missing the
 *   `concurrency:` block entirely, two were missing `pull-requests: read` (whose absence
 *   makes every pull-request scan fail 403), the gitleaks action was pinned at `@v2` in
 *   five and `@v3` in eight, and the weekly cron minute took three different values. Not
 *   one of those differences was a decision. They are what happens when the same edit is
 *   applied by hand thirteen times.
 *
 * ⛔ SO: A DIFFERENCE IS EITHER AN INPUT OR AN EXCEPTION. Nothing else. A repository that
 *   needs something the standard does not give it either widens this type — and every
 *   repository gets the widening — or declares an exception with a stated reason. There
 *   is no third option where a file is quietly edited, because `drift.ts` fails on it.
 *
 * ⚠️ THE REASON IS ENFORCED BY THE COMPILER, NOT BY REVIEW. `except()` and `extraJob()`
 *   below refuse an empty reason and refuse a reason read out of a variable, so the text
 *   has to be written at the exception. See `Stated`.
 */

/** Where a repository's jobs run. */
export type RepoRunner =
  /**
   * `[self-hosted, homeflare-mini]` — the interim Linux arm64 runner on the Mac mini.
   * ⚠️ GitHub-hosted runners are refused for this account (billing lock, 2026-09-22).
   */
  | 'mini'
  /** `ubuntu-latest`. Public repositories, where GitHub-hosted minutes are free. */
  | 'github';

/** One step in a rendered job. Either a `uses:` or a `run:`, never both. */
export type JobStep = {
  readonly name?: string;
  /**
   * The step's `if:` condition, verbatim.
   *
   * ★ WIDENED RATHER THAN EXCEPTED, 2026-09-22. homeflare-kit's `consumer smoke test`
   *   ends with a step that renders the packed tarball sizes onto the run summary, and
   *   it carries `if: always()` on purpose — a FAILED smoke test is exactly when the
   *   sizes are worth reading. Without this field kit had two options and both were
   *   worse: drop the condition, losing the summary on the only runs that need it, or
   *   `except('.github/workflows/ci.yml')`, which buys one repository its file back and
   *   costs the estate the guarantee on it. One optional key gives every repository the
   *   same freedom, which is the order of preference this module documents.
   * ⚠️ NOT VALIDATED. GitHub's expression grammar is the vendor's; a bad condition is
   *   caught by `actionlint` in the `workflow lint` job, which is where it belongs.
   */
  readonly if?: string;
  readonly env?: Readonly<Record<string, string>>;
} & (
  | {
      readonly uses: string;
      readonly with?: Readonly<Record<string, string | number>>;
      readonly run?: never;
    }
  | { readonly run: string; readonly uses?: never; readonly with?: never }
);

/**
 * ⛔ A REASON MUST BE WRITTEN, NOT COMPUTED. `'' extends R` is true for the empty literal
 *   AND for the wide `string` type, so both collapse to `never` and fail to typecheck:
 *   `reason: ''` is refused, and so is `reason: someVariable`. Only a string literal
 *   written at the call site survives — which is the whole point, because a reason
 *   assembled at runtime is a reason nobody reads in the diff.
 *   Verified against TypeScript 7.0.2 on 2026-09-22; `tests/repo-shape-reason.test.ts`
 *   compiles the refusals and asserts they still fail.
 */
export type Stated<R extends string> = '' extends R ? never : R;

/** Paths this package renders. A deviation names one of these, not an arbitrary file. */
export type RenderedPath =
  | '.changeset/config.json'
  | '.github/actionlint.yaml'
  | '.github/dependabot.yml'
  | '.github/workflows/ci.yml'
  | '.github/workflows/dependabot-automerge.yml'
  | '.github/workflows/security.yml';

export interface RepoShapeException {
  /** The rendered file this repository does not take from the renderer. */
  readonly file: RenderedPath;
  /** Why — written at the exception, in a sentence a stranger can act on. */
  readonly reason: string;
  /** `YYYY-MM-DD` the exception was taken, so a stale one is visible. */
  readonly since: string;
}

interface ExceptionInput {
  readonly file: RenderedPath;
  readonly reason: string;
  readonly since: string;
}

/**
 * Declare that this repository keeps its own copy of a rendered file.
 *
 *     except({
 *       file: '.github/workflows/ci.yml',
 *       reason: 'Payload needs Node >=24.15, which the rendered job does not install',
 *       since: '2026-09-22',
 *     })
 *
 * ⛔ THE DRIFT CHECK STOPS CHECKING THAT FILE. That is the trade: an exception buys the
 *   freedom to hand-edit one file and pays for it by losing the guarantee on that file.
 *   Prefer widening `RepoShape` — then every repository benefits and nothing is lost.
 */
export function except<const E extends ExceptionInput>(
  exception: E & { readonly reason: Stated<E['reason']> },
): RepoShapeException {
  return {
    file: exception.file,
    reason: requireSentence('reason', exception.reason),
    since: requireIsoDate(exception.since),
  };
}

export interface ExtraJob {
  /** The job key in `jobs:`, e.g. `package`. Lower-case, dashes allowed. */
  readonly id: string;
  /**
   * The job's `name:`, which is also the status-check context. It joins the `ci`
   * aggregate's `needs`, so the branch ruleset still requires exactly one check.
   */
  readonly name: string;
  /** Why this repository has a job the other twelve do not. */
  readonly reason: string;
  /** Steps after checkout. The prologue (checkout, bun, install) is rendered for you. */
  readonly steps: readonly JobStep[];
  /** Job ids this one waits for. Default: none, so it runs beside `check`. */
  readonly needs?: readonly string[];
  /** `false` skips the rendered bun prologue — for a job that needs another toolchain. */
  readonly bun?: boolean;
}

interface ExtraJobInput extends Omit<ExtraJob, 'needs' | 'bun'> {
  readonly needs?: readonly string[];
  readonly bun?: boolean;
}

/**
 * Declare a job this repository needs and the standard does not have.
 * ⛔ Same rule as `except`: the reason is a written literal or it does not compile.
 */
export function extraJob<const J extends ExtraJobInput>(
  job: J & { readonly reason: Stated<J['reason']> },
): ExtraJob {
  if (job.steps.length === 0) {
    throw new Error(`repo-shape: extra job "${job.id}" has no steps`);
  }
  return {
    bun: job.bun ?? true,
    id: requireJobId(job.id),
    // ⚠️ A DISPLAY NAME IS NOT A SENTENCE. `build` and `consumer smoke test` are both
    //   correct job names; only the REASON has to be prose, because only the reason is
    //   there for a reader rather than for the checks list.
    name: requireNonEmpty('name', job.name),
    needs: [...(job.needs ?? [])],
    reason: requireSentence('reason', job.reason),
    steps: [...job.steps],
  };
}

export interface RepoShape {
  /** Repository owner — a user or organization login. */
  readonly owner: string;
  /** Repository name, which is also the checkout directory name. */
  readonly repository: string;
  /** Where its jobs run. */
  readonly runner: RepoRunner;
  /**
   * `true` when the repository publishes an npm tarball. It decides `access` in the
   * changeset config and whether `privatePackages` is written at all — the two keys
   * that differ between `homeflare-kit` and every other repository.
   */
  readonly publishes: boolean;
  /** Jobs beyond `check` and `workflows`. Each carries its own stated reason. */
  readonly extraJobs?: readonly ExtraJob[];
  /** Rendered files this repository keeps its own copy of, each with a reason. */
  readonly exceptions?: readonly RepoShapeException[];
}

const SENTENCE = 12;

function requireNonEmpty(field: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`repo-shape: ${field} must not be blank`);
  return trimmed;
}

function requireSentence(field: string, value: string): string {
  const trimmed = value.trim();
  // ⚠️ THE TYPE CANNOT CATCH `reason: '   '`. `'   '` is a non-empty literal, so `Stated`
  //   lets it through and only this does not. Type and guard cover different halves.
  if (trimmed.length < SENTENCE) {
    throw new Error(`repo-shape: ${field} must be a sentence, got ${JSON.stringify(value)}`);
  }
  return trimmed;
}

function requireIsoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`repo-shape: since must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireJobId(value: string): string {
  // ⛔ The id becomes a YAML key and a `needs:` entry. Anything else renders a workflow
  //   GitHub rejects at parse time, which reports as "workflow file issue" with no line.
  if (!/^[a-z][a-z0-9_-]*$/.test(value)) {
    throw new Error(
      `repo-shape: job id must match /^[a-z][a-z0-9_-]*$/, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** `runs-on:` for a runner. */
export function runsOn(runner: RepoRunner): string {
  return runner === 'mini' ? '[self-hosted, homeflare-mini]' : 'ubuntu-latest';
}

/** Whether a rendered path is excepted by this shape. */
export function isExcepted(shape: RepoShape, file: RenderedPath): boolean {
  return (shape.exceptions ?? []).some((exception) => exception.file === file);
}
