/**
 * Upsert the gold-standard `main` branch ruleset onto ONE named taslabs-net repository.
 * The ruleset shape itself, and why it is not declared in Alchemy, live in
 * docs/github-hygiene.md and scripts/github-ruleset.ts.
 *
 * ⛔ NOT WIRED INTO `bun run check`. This mutates a repository's GitHub settings, which
 *   is an operator action, not a build gate — see AGENTS.md "do not copy app-only
 *   behavior into this package producer."
 *
 * ⛔ FAILS CLOSED, FOUR WAYS: no `--repo` (nothing to target), no `GITHUB_TOKEN` /
 *   `GH_TOKEN` (nothing to authenticate with), `--require-checks`/`--repo` given with a
 *   missing or flag-shaped value (an explicit flag with no real value is a mistake, not
 *   "off"), and more than one ruleset named `main` targeting `branch` (this script does
 *   not guess which one is THE one — see `applyMainRuleset` below).
 *
 * ⛔ REQUIRED CHECKS DEFAULT OFF, BUT ONLY ON CREATE. A brand-new repo has no green CI
 *   run yet; requiring `ci` before one exists locks out every PR, including the one that
 *   would fix it. On UPDATE, omitting `--require-checks` PRESERVES whatever
 *   `required_status_checks` rule is already live — a plain rerun must never be the
 *   thing that silently turns required checks back off. Passing `--require-checks`
 *   explicitly always replaces it, on either path.
 *
 * ⛔ NEVER WIDENS `bypass_actors`. There is no flag for it. Creating a ruleset starts
 *   locked down (`[]`); updating one reads the CURRENT value back from GitHub and
 *   passes it through unchanged — this script has no opinion on who may bypass a rule
 *   it did not add, so it never silently grants or revokes that access.
 */
import { Octokit } from '@octokit/rest';
import {
  RULESET_NAME,
  type RulesetGateway,
  type RulesetRule,
  buildPayload,
  buildRules,
  describeRule,
  octokitGateway,
  resolveRulesForUpdate,
} from './github-ruleset.ts';

const OWNER = 'taslabs-net';
const USAGE =
  'usage: bun run scripts/apply-main-ruleset.ts --repo <name> [--require-checks ctx,ctx] [--dry-run]';

export interface RulesetOptions {
  readonly repo: string;
  readonly requiredChecks?: readonly string[] | undefined;
  readonly dryRun: boolean;
}

export interface ApplyResult {
  readonly action: 'created' | 'updated' | 'dry-run-create' | 'dry-run-update';
  readonly rulesetId?: number | undefined;
  readonly htmlUrl?: string | undefined;
  readonly rules: readonly RulesetRule[];
}

/**
 * Fails closed, in order: an empty/whitespace repo (before calling the gateway at all),
 * and more than one `main`-named ruleset targeting `branch` (before reading or writing
 * either of them) — this script converges exactly one ruleset, never guesses which.
 */
export async function applyMainRuleset(
  gateway: RulesetGateway,
  options: RulesetOptions,
): Promise<ApplyResult> {
  if (options.repo.trim() === '') {
    throw new Error(`apply-main-ruleset: --repo is required. ${USAGE}`);
  }

  const candidates = (await gateway.list(options.repo)).filter(
    (r) => r.name === RULESET_NAME && (r.target === undefined || r.target === 'branch'),
  );
  if (candidates.length > 1) {
    const ids = candidates.map((c) => c.id).join(', ');
    throw new Error(
      `apply-main-ruleset: ${candidates.length} rulesets named "${RULESET_NAME}" target branch on ` +
        `${options.repo} (ids: ${ids}) — refusing to guess which one to converge. Resolve the ` +
        'duplicate on GitHub first.',
    );
  }
  const existing = candidates[0];

  if (existing === undefined) {
    // CREATE: default OFF applies here — a brand-new ruleset has nothing to preserve.
    const rules = buildRules(options.requiredChecks);
    if (options.dryRun) return { action: 'dry-run-create', rules };
    const created = await gateway.create(options.repo, buildPayload(rules, []));
    return { action: 'created', rulesetId: created.id, htmlUrl: created.htmlUrl, rules };
  }

  // ⛔ Read the FULL ruleset, not the list entry — GitHub's list endpoint omits
  //   `bypass_actors`, and passing it through unread would silently narrow it to `[]`.
  const current = await gateway.get(options.repo, existing.id);
  // UPDATE: explicit --require-checks replaces; omitted preserves the current rule exactly.
  const rules = resolveRulesForUpdate(options.requiredChecks, current.requiredStatusChecksRule);
  if (options.dryRun) return { action: 'dry-run-update', rulesetId: existing.id, rules };

  const updated = await gateway.update(
    options.repo,
    existing.id,
    buildPayload(rules, current.bypassActors),
  );
  return { action: 'updated', rulesetId: updated.id, htmlUrl: updated.htmlUrl, rules };
}

/** A value flag (`--repo`, `--require-checks`) with nothing after it, or another flag right after it, is a mistake — never silently swallow the next flag as if it were a value. */
function takeValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`apply-main-ruleset: ${flag} needs a value. ${USAGE}`);
  }
  return value;
}

/** Fails closed: throws rather than guessing a repo, or accepting `--require-checks` with no contexts. */
export function parseArgs(argv: readonly string[]): RulesetOptions {
  let repo: string | undefined;
  let requiredChecks: readonly string[] | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') {
      repo = takeValue(argv, i, '--repo');
      i += 1;
    } else if (arg === '--require-checks') {
      const raw = takeValue(argv, i, '--require-checks');
      i += 1;
      const contexts = raw
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (contexts.length === 0) {
        throw new Error(
          `apply-main-ruleset: --require-checks needs at least one context. ${USAGE}`,
        );
      }
      requiredChecks = contexts;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      throw new Error(`apply-main-ruleset: unrecognized argument '${arg ?? ''}'. ${USAGE}`);
    }
  }

  if (repo === undefined || repo.trim() === '') {
    throw new Error(`apply-main-ruleset: --repo is required. ${USAGE}`);
  }
  if (!/^[\w.-]+$/.test(repo)) {
    throw new Error(
      `apply-main-ruleset: '${repo}' does not look like a bare repo name (no owner, no slash).`,
    );
  }

  return { repo, requiredChecks, dryRun };
}

if (import.meta.main) {
  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
  if (token === undefined || token.trim() === '') {
    console.error(
      'apply-main-ruleset: set GITHUB_TOKEN or GH_TOKEN — refusing to run unauthenticated.',
    );
    process.exit(1);
  }

  try {
    const options = parseArgs(process.argv.slice(2));
    const gateway = octokitGateway(new Octokit({ auth: token }));
    const result = await applyMainRuleset(gateway, options);
    const location = result.htmlUrl !== undefined ? ` — ${result.htmlUrl}` : '';

    console.log(`${result.action} ${OWNER}/${options.repo}#${RULESET_NAME}${location}`);
    for (const rule of result.rules) console.log(`  - ${describeRule(rule)}`);
    if (options.requiredChecks === undefined) {
      console.log('  (--require-checks omitted — created OFF, or preserved as-is on update)');
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
