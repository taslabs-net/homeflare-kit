# GitHub Alchemy stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt `taslabs-net/homeflare-kit` with vendor `alchemy/GitHub` and declare an `npm` Environment that `release.yml` publishes from.

**Architecture:** Root `alchemy.run.ts` is a local-state stack (no apply on push). It adopts the existing repo and creates/converges `GitHub.Environment("npm")`. `NPM_TOKEN` stays a repository secret. `@homeflare/alchemy` is not imported.

**Tech Stack:** Alchemy 2.0.0-beta.77, Effect 4.0.0-rc.112, existing GitHub Actions + changesets.

## Global Constraints

- Do not import `@homeflare/alchemy`.
- Do not manage `NPM_TOKEN` in the stack.
- Do not declare branch protection (the `main` ruleset owns it).
- Do not `alchemy deploy` on every push; `.alchemy/` stays gitignored.
- Root `devDependencies` use `catalog:`; pins match `@homeflare/alchemy` (`alchemy@2.0.0-beta.77`, `effect@4.0.0-rc.112`).
- No changeset (no published package changes).
- Comments: `⛔` / `⚠️` / `★` with measured facts. Files ≤250 lines, docs ≤200.

---

### Task 1: Gate `release.yml` on the `npm` environment

**Files:**

- Modify: `tests/workflows.test.ts`
- Modify: `.github/workflows/release.yml`
- Modify: `docs/releasing.md`

**Interfaces:**

- Consumes: existing `release.yml` job `release`
- Produces: `jobs.release.environment === 'npm'`

- [ ] **Step 1: Write the failing test**

Add to `tests/workflows.test.ts` inside `describe('workflows')`:

```ts
test('release publishes from the npm environment', async () => {
  // ★ Alchemy adopts this repo and declares Environment "npm". The job must
  //   name it, or the environment is documentation and publish stays unbound.
  const text = await Bun.file(new URL('../.github/workflows/release.yml', import.meta.url)).text();
  const doc = Bun.YAML.parse(text) as {
    jobs: { release: { environment?: string } };
  };

  expect(doc.jobs.release.environment).toBe('npm');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ./tests/workflows.test.ts -t "release publishes from the npm"`
Expected: FAIL — `environment` is undefined.

- [ ] **Step 3: Wire the job and document it**

On `jobs.release` in `.github/workflows/release.yml` (sibling of `runs-on`):

```yaml
environment: npm
```

Add a comment above it:

```yaml
# ★ Publish sits in the `npm` Environment that alchemy.run.ts declares.
#   NPM_TOKEN stays a repository secret — GitHub still injects it here.
environment: npm
```

In `docs/releasing.md` under GitHub Actions, add:

```md
★ **`release.yml` uses `environment: npm`.** Alchemy adopts this repo and
declares that environment (`alchemy.run.ts`). The token stays a repository
secret; the environment is the trust boundary for which job may publish.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test ./tests/workflows.test.ts -t "release publishes from the npm"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/workflows.test.ts .github/workflows/release.yml docs/releasing.md
git commit -m "$(cat <<'EOF'
ci(release): publish from the npm Environment

The job names the environment Alchemy will adopt, so publish is bound to it. NPM_TOKEN stays a repository secret.
EOF
)"
```

---

### Task 2: Root stack that adopts the repo and the environment

**Files:**

- Create: `alchemy.run.ts`
- Modify: `package.json` (catalog + root `devDependencies`)
- Modify: `tsconfig.json` (`include` adds `alchemy.run.ts`)
- Modify: `bun.lock` (via `bun install`)

**Interfaces:**

- Consumes: `Alchemy.Stack`, `GitHub.providers()`, `Alchemy.localState()`, `GitHub.Repository`, `GitHub.Environment`
- Produces: default-exported stack `HomeFlareKit`

- [ ] **Step 1: Add catalog pins and install**

In root `package.json` `catalog`:

```json
"alchemy": "2.0.0-beta.77",
"effect": "4.0.0-rc.112"
```

In root `devDependencies`:

```json
"alchemy": "catalog:",
"effect": "catalog:"
```

Run: `bun install`
Expected: lockfile updates; `bun test ./tests/catalog.test.ts` still PASS.

- [ ] **Step 2: Include the stack in root typecheck**

`tsconfig.json` `include`:

```json
"include": ["tests", "scripts", "alchemy.run.ts"]
```

- [ ] **Step 3: Write `alchemy.run.ts`**

```ts
/**
 * Adopt this GitHub repo with the vendor provider.
 *
 * ⛔ NOT `@homeflare/alchemy`. That package is Forgejo / Proxmox / OpenBao / Talos
 *   / R2 locks — systems Alchemy has none for. GitHub is first-class (`alchemy/GitHub`).
 * ★ THE USEFUL OBJECT IS Environment "npm". release.yml publishes from it.
 * ⛔ NPM_TOKEN STAYS A REPOSITORY SECRET. Putting it in the stack would write the
 *   token into `.alchemy/` state. GitHub still injects repo secrets into an
 *   environment job.
 * ⚠️ LOCAL STATE ONLY. `.alchemy/` is gitignored. Do not `alchemy deploy` on every
 *   CI push — a fresh runner looks empty and fights the last apply. First apply
 *   is `bun alchemy deploy` on a machine that can administer this repo.
 * ⛔ DO NOT DECLARE BRANCH PROTECTION. The `main` ruleset already owns it.
 */
import * as Alchemy from 'alchemy';
import * as GitHub from 'alchemy/GitHub';
import * as Effect from 'effect/Effect';

const OWNER = 'taslabs-net';
const NAME = 'homeflare-kit';

export default Alchemy.Stack(
  'HomeFlareKit',
  {
    providers: GitHub.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const repo = yield* GitHub.Repository(NAME, {
      owner: OWNER,
      name: NAME,
      deleteBranchOnMerge: true,
      hasWiki: false,
    });

    yield* GitHub.Environment('npm', {
      owner: OWNER,
      repository: NAME,
      name: 'npm',
      deploymentBranchPolicy: { customBranchPolicies: ['main'] },
    });

    return { repo: repo.fullName };
  }),
);
```

- [ ] **Step 4: Typecheck**

Run: `bun run types`
Expected: exit 0. If `GitHub.providers` / `Environment` props fail, fix against `alchemy/GitHub` types — do not invent a wrapper.

- [ ] **Step 5: Commit**

```bash
git add alchemy.run.ts package.json bun.lock tsconfig.json
git commit -m "$(cat <<'EOF'
feat: adopt this GitHub repo with Alchemy

Vendor alchemy/GitHub adopts taslabs-net/homeflare-kit and declares the npm Environment release.yml already names. Token stays a repo secret; state stays local.
EOF
)"
```

---

### Task 3: Spec + plan in the tree; verify

**Files:**

- Already created: `docs/superpowers/specs/2026-09-16-github-alchemy-stack-design.md`
- This plan

- [ ] **Step 1: Full verify**

Run: `bun run verify`
Expected: exit 0

- [ ] **Step 2: Commit docs if untracked**

```bash
git add docs/superpowers
git commit -m "$(cat <<'EOF'
docs: spec and plan for the GitHub Alchemy stack
EOF
)"
```
