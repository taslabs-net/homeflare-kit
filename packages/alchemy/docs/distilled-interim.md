# The distilled interim-package route

How a `@distilled.cloud/<vendor>` SDK reaches the kit before it exists on
npm — established by `packages/distilled-netbox` (the first one); every
later vendor (PVE, PBS, paperless, …) follows this exactly.

## Why this exists

★ **Upstream Alchemy only accepts a provider that calls `@distilled.cloud/<vendor>`
operations and `catchTag`s their typed errors** (alchemy PR 1425: "We don't
accept providers without this"). The kit wants to dogfood and test on real
`@distilled.cloud/*` packages now, but `alchemy-run/distilled` is upstream —
⛔ **the kit never pushes to it.** Decision 42: build inside the kit first,
fork `alchemy-run/distilled` and go upstream only with explicit later
sign-off. Until a vendor's package is merged and released there, it does not
exist on npm under `@distilled.cloud/<vendor>` — so there is nothing to
`bun add`.

★ **The fix is one alias.** `package.json` can point a dependency name at any
tarball, including one on npm under a different name:

```json
"@distilled.cloud/netbox": "npm:@homeflare/distilled-netbox@0.1.0"
```

Everything importing `@distilled.cloud/netbox` resolves to the interim
package's code, unmodified. When the real package ships, the alias's target
changes and nothing else does.

## The five steps

### 1. Build the SDK the distilled way, in its own worktree

Follow `.agents/skills/distilled-sdk/SKILL.md` in the local distilled clone —
Steps 1–8 (never Step 9, which pushes). One worktree per vendor, branch
`homeflare/<vendor>`, off `homeflare/base`. Spec sourcing, `patches/`,
`convert.ts`/`generate.ts`, `pnpm typecheck:ci` (never plain `typecheck`,
which skips generated code — `noCheck: true`), `pnpm format`,
`pnpm specs:check`. Commit in the local clone only — ⛔ **never push it
anywhere; no forks, no PRs, no issues or comments on `alchemy-run/distilled`
from this route.**

⚠️ **A vendor with no machine-readable spec still gets a `SPEC_REPOS` entry**
(`stacks/distilled-submodules/SpecRepos.ts`) with `blocked` and a reason. Upstream's
Slack entry is the precedent. A blocked entry still declares the mirror repository,
but skips fetch scaffolding; it does not pretend there is a spec to fetch.
Caddy follows it (Q7, decision 49, 2026-09-24): the local `homeflare/caddy` worktree's
`packages/caddy/docs/provenance.md` records the admin-API spec search against Caddy
2.11.4's Go source and website. Its admin-operation model is hand-authored, and its
`SpecRepos.ts` entry records that reason. The separately discovered config-tree
metadata is not an admin-operation specification.

### 2. Copy into a kit workspace package

```sh
mkdir -p packages/distilled-<vendor>/src
cp -R <distilled-clone>/packages/<vendor>/src/. packages/distilled-<vendor>/src/
```

⛔ **`src/` is copied, never hand-edited in the kit.** A bug found here (the
netbox package's own history: a doubled `/api/api/` prefix, caught by its
`scripts/smoke.ts`, not by typecheck) is fixed in the distilled clone,
regenerated, and copied back — never patched in place in the kit. The
package's own README says so; keep saying so for the next vendor too.

`package.json` (write by hand, once, then keep almost untouched across
regenerations):

- `"name"`: `"@homeflare/distilled-<vendor>"`
- `"dependencies"`: `{ "@distilled.cloud/core": "1.0.0-rc.12" }` — the
  **exact** version, a real npm dependency (`@distilled.cloud/core` is
  already published; only the vendor package is missing). Never
  `"workspace:*"` — this package is not part of the distilled workspace.
- `"peerDependencies"`: `{ "effect": "4.0.0-rc.115" }` — the kit's own
  `effect` override (root `package.json` → `overrides`), pinned literally
  (matching `packages/alchemy`'s own peer on `effect`, not the `catalog:`
  protocol — a peerDependency is resolved by the _consumer's_ installer, and
  `catalog:` only expands inside this workspace).
- `"license"`: `"Apache-2.0"`, **not** the kit's usual MIT — the content is a
  redistribution of `alchemy-run/distilled`'s own Apache-2.0 output. Ship its
  `LICENSE` file (copied from the distilled clone root) alongside.
- `"scripts"`: `build` (`tsc -p tsconfig.json`), `types` (same, `--noEmit`),
  `test` (`bun test`), `smoke` (`bun run scripts/smoke.ts`) — the four every
  kit package answers to `bun run --filter '*' <script>`.

`tsconfig.json`: **self-contained**, not `packages/config`'s
`tsconfig.lib.json` preset. That preset requires `isolatedDeclarations`,
which the distilled generator's own output does not satisfy (its
`as any as S.Schema<X>` cast pattern) and was never written to satisfy —
forcing it through a different lib preset on every copy is exactly the
friction this route exists to avoid. Copy `packages/distilled-netbox/tsconfig.json`
and change nothing but the package name in its comment.

**Formatting/linting are excluded, on purpose.** `.oxfmtrc.json` and
`.oxlintrc.json` both ignore `packages/distilled-*/src/**` at the repo root —
already wired for every future vendor, not just netbox. Reformatting a
generated SDK to house style would fight the source of truth on every
regeneration; the hand-written files alongside it (`package.json`,
`tsconfig.json`, `scripts/smoke.ts`, `README.md`) are NOT excluded and are
checked normally.

### 3. Prove it before shipping

Two checks, both real, neither skippable:

1. **`bun run --filter '@homeflare/distilled-<vendor>' types`** — typechecks
   inside the KIT's own dependency graph (real npm `@distilled.cloud/core`,
   not the distilled workspace's local one). A green typecheck in the
   distilled clone does not by itself prove this; the netbox package
   typechecked in both places, which is the point of checking both.
2. **`scripts/smoke.ts`** — packs the tarball, installs it into a scratch
   dir under its OWN published name (never the alias — the alias is the
   _consumer's_ concern), and builds a real request for one operation
   against a fake `HttpClient` (`effect/unstable/http/HttpClient.make`,
   capturing the request instead of sending it). Assert on method, URL and
   headers, and decode a canned response. This is what caught the `/api/api/`
   bug — a clean typecheck did not, because the bug was in a runtime string,
   not a type.

### 4. Publish through the kit's own changesets release

No special-casing: add a changeset (`bun changeset`, minor — new package),
push, merge. `scripts/publish.ts` packs with `bun pm pack` (resolves
`workspace:`/`catalog:` the way `npm pack` cannot) and publishes with `npm
publish --provenance` from CI. `README.md`/`LICENSE`/`scripts/smoke.ts` ship
in `files`; nothing about the release pipeline needs to know this package is
an interim stand-in.

### 5. Alias it in, then cut over later

Once the interim package is on npm (`npm view @homeflare/distilled-<vendor>
version` — **npm's CDN lags a few minutes after release**, so don't chase an
empty read as a failure), the FIRST consuming PR adds the alias to whichever
kit package needs the vendor's operations:

```json
"@distilled.cloud/<vendor>": "npm:@homeflare/distilled-<vendor>@<version>"
```

in `dependencies` (not `peerDependencies` — the kit package needs it
resolved, not left to whoever installs the kit package). Everything in that
PR imports `@distilled.cloud/<vendor>`, never `@homeflare/distilled-<vendor>`
directly — ⛔ **that is what makes the eventual cutover a one-line change.**

When `@distilled.cloud/<vendor>` is genuinely published upstream: replace the
alias's target version with the real one (or drop the alias for a plain
`"@distilled.cloud/<vendor>": "<version>"`), delete `packages/distilled-<vendor>`,
run `bun install`. No import in the kit changes. **STATE MUST NOT MOVE** —
this is a transport swap, not a redesign; an adopted resource's plan must
stay a no-op across the cutover, the same invariant the distilled walk-down
itself holds everywhere else.

## What NOT to do

- ⛔ Don't move existing hand-written resources (e.g. the kit's own
  `packages/alchemy/src/netbox/*`) onto the interim package in the same PR
  that introduces it. The alias can only resolve once the package is
  actually published — that migration is its own PR, after `npm view`
  confirms the version is live.
- ⛔ Don't add the alias speculatively before the interim package is
  published — `bun install` would fail to resolve it.
- ⛔ Don't hand-fix a bug inside `packages/distilled-<vendor>/src/`. Fix it
  upstream (the distilled clone), regenerate, copy again.
