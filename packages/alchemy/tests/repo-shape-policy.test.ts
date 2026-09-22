/**
 * The seam between the two halves of a standard repository: the FILES that produce a
 * status check, and the SETTINGS that require it.
 *
 * ★ THIS IS THE ONLY PLACE THAT IMPORTS BOTH PACKAGES, and it is a test rather than a
 *   dependency. `@homeflare/config` is installed in 13 of 14 estate repositories and
 *   `@homeflare/alchemy` in 4 (measured 2026-09-22), so the renderer must not drag
 *   Alchemy and Effect into a repository with no stack, and the policy helper must not
 *   drag a file renderer into one that only declares resources. They meet structurally:
 *   `renderRepoShape(shape).policy` is assignable to `RepoPolicyOptions`, and this asserts
 *   that it stays so.
 *
 * ⛔ WHAT BREAKS WITHOUT THIS TEST. Nothing, at first — and that is the problem. A rename
 *   of the aggregate job in the renderer, or of `checks` in the policy form, compiles in
 *   both packages and only shows up on a live repository: the ruleset requires a context
 *   no workflow reports, the context stays *pending* rather than failing, and every pull
 *   request waits on it forever with auto-merge armed. That failure has no error message.
 */
import { describe, expect, test } from 'bun:test';
import { type RepoShape, extraJob, renderRepoShape } from '../../config/src/repo-shape.ts';
import { type RepoPolicyOptions, repoPolicy } from '../src/github/repo-policy-form.ts';

const SHAPE: RepoShape = {
  owner: 'taslabs-net',
  publishes: false,
  repository: 'homeflare-proxmox',
  runner: 'mini',
};

describe('one declaration gives a repository both halves', () => {
  test('the rendered policy is accepted by repoPolicy as-is', () => {
    const rendered = renderRepoShape(SHAPE);
    // ⚠️ The annotation is the assertion: if `RepoShapePolicy` and `RepoPolicyOptions`
    //   stop agreeing, this line fails to compile — which is earlier than any runtime
    //   check could be, and earlier than a deploy.
    const options: RepoPolicyOptions = rendered.policy;
    const policy = repoPolicy(options);

    expect(policy.repository.name).toBe('homeflare-proxmox');
    expect(policy.repository.allowAutoMerge).toBe(true);
    expect(policy.repository.allowMergeCommit).toBe(false);
    expect(policy.repository.deleteBranchOnMerge).toBe(true);
  });

  test('the required checks are exactly the contexts the rendered workflows report', () => {
    const rendered = renderRepoShape(SHAPE);
    const required = repoPolicy(rendered.policy).ruleset.rules?.requiredStatusChecks?.checks ?? [];
    const contexts = required.map((check) => check.context).sort();

    const ci = Bun.YAML.parse(rendered.files['.github/workflows/ci.yml'] ?? '') as {
      jobs: Record<string, { name: string }>;
    };
    const security = Bun.YAML.parse(rendered.files['.github/workflows/security.yml'] ?? '') as {
      jobs: Record<string, { name: string }>;
    };
    const reported = new Set([
      ...Object.values(ci.jobs).map((job) => job.name),
      ...Object.values(security.jobs).map((job) => job.name),
    ]);

    // ⛔ EVERY REQUIRED CONTEXT MUST BE ONE A RENDERED JOB ACTUALLY REPORTS. A required
    //   context nothing reports is not "failing", it is "pending" — forever.
    for (const context of contexts) expect([...reported]).toContain(context);
    expect(contexts).toEqual(['ci', 'secret scan']);
  });

  test('an extra job does not become a required check of its own', () => {
    const rendered = renderRepoShape({
      ...SHAPE,
      extraJobs: [
        extraJob({
          id: 'build',
          name: 'build',
          reason: 'this repository ships a frontend the Worker serves, which most do not',
          steps: [{ run: 'bun run build:web' }],
        }),
      ],
    });
    // ★ It joins the `ci` aggregate's `needs` instead, so adding a job never means
    //   editing a ruleset — the thing that made adding a check a two-repo change.
    expect(rendered.policy.checks).toEqual(['ci', 'secret scan']);
    expect(rendered.files['.github/workflows/ci.yml']).toContain(
      'needs: [check, workflows, build]',
    );
  });
});
