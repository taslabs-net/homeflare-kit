/**
 * Upsert the gold-standard `main` branch ruleset onto ONE named taslabs-net repository.
 * The ruleset shape itself, and why it is not declared in Alchemy, live in
 * docs/github-hygiene.md and scripts/github-ruleset.ts.
 *
 * ⛔ NOT WIRED INTO `bun run check`. This mutates a repository's GitHub settings, which
 *   is an operator action, not a build gate — see AGENTS.md "do not copy app-only
 *   behavior into this package producer."
 *
 * ⛔ FAILS CLOSED, THREE WAYS: no `--repo` (nothing to target), no `GITHUB_TOKEN` /
 *   `GH_TOKEN` (nothing to authenticate with), and `--require-checks` given with no
 *   contexts (an explicit flag with an empty value is a mistake, not "off").
 *
 * ⛔ REQUIRED CHECKS DEFAULT OFF. A brand-new repo has no green CI run yet; requiring
 *   `ci` before one exists locks out every PR, including the one that would fix it.
 *   Pass `--require-checks ci,secret scan` only once the repo has a green run to require.
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

/** Fails closed on an empty/whitespace repo BEFORE calling the gateway at all. */
export async function applyMainRuleset(
  gateway: RulesetGateway,
  options: RulesetOptions,
): Promise<ApplyResult> {
  if (options.repo.trim() === '') {
    throw new Error(`apply-main-ruleset: --repo is required. ${USAGE}`);
  }

  const rules = buildRules(options.requiredChecks);
  const existing = (await gateway.list(options.repo)).find(
    (r) => r.name === RULESET_NAME && (r.target === undefined || r.target === 'branch'),
  );

  if (existing === undefined) {
    if (options.dryRun) return { action: 'dry-run-create', rules };
    const created = await gateway.create(options.repo, buildPayload(options.requiredChecks, []));
    return { action: 'created', rulesetId: created.id, htmlUrl: created.htmlUrl, rules };
  }

  // ⛔ Read the FULL ruleset, not the list entry — GitHub's list endpoint omits
  //   `bypass_actors`, and passing it through unread would silently narrow it to `[]`.
  const current = await gateway.get(options.repo, existing.id);
  if (options.dryRun) return { action: 'dry-run-update', rulesetId: existing.id, rules };

  const payload = buildPayload(options.requiredChecks, current.bypassActors ?? []);
  const updated = await gateway.update(options.repo, existing.id, payload);
  return { action: 'updated', rulesetId: updated.id, htmlUrl: updated.htmlUrl, rules };
}

/** Fails closed: throws rather than guessing a repo, or accepting `--require-checks` with no contexts. */
export function parseArgs(argv: readonly string[]): RulesetOptions {
  let repo: string | undefined;
  let requiredChecks: readonly string[] | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') {
      repo = argv[i + 1];
      i += 1;
    } else if (arg === '--require-checks') {
      const raw = argv[i + 1];
      i += 1;
      const contexts = (raw ?? '')
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
      console.log('  (required checks OFF — pass --require-checks once CI is green)');
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
