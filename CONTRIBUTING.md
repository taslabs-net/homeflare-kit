# Contributing

This package is consumed by every HomeFlare app, so a change here lands in all of them at
once. That is the whole point of the repo — and the reason the gates below are strict.

## Getting set up

```sh
bun install
bun run verify   # lint + types + build + tests + consumer smoke test
```

⛔ **Bun only.** No `npm install`, no `pnpm install`, no `yarn` — a second lockfile is a
failed install, not a peer. (Bun is the _toolchain_; consumers install the published
tarball with whatever they like. See [AGENTS.md](./AGENTS.md).)

## Making a change

1. Branch: `feat/`, `fix/`, `docs/`, `refactor/`, `perf/`, `test/`, `build/`, `ci/`,
   `chore/`.
2. Write the change **and its test**. See "What a good change looks like" below.
3. `bun run changeset` — describe the change in the user's terms, not the diff's.
   ⛔ A PR that changes published behaviour without a changeset will not release. The
   version PR is generated from these files, so a missing one means a silent no-op.
4. `bun run verify` before pushing. CI runs the same thing; failing locally is faster.
5. Conventional Commits: `<type>[scope]: <description>`.

## What a good change looks like

**Every exported symbol carries an explicit type.** `isolatedDeclarations` is on, so the
compiler enforces this. ★ It is not style: `bun build` cannot emit `.d.ts`, so the types
come from a separate `tsc` pass, and explicit types are what stop the two from drifting.

**The main entrypoint stays runtime-neutral.** ⛔ Nothing in `src/index.ts` may import
`bun:*`, `node:*`, or touch a filesystem — consumers run this code on Cloudflare
Workers. Runtime-specific code goes behind its own subpath export so a consumer opts in.

**Comments carry the measurement.** `⛔` a rule and what breaks if it is broken · `⚠️` a
trap and the SYMPTOM it produces · `★` why a choice was made over the obvious one. A date
and the word "measured" beat an assertion.

**Files stay small**: code ≤250 lines, documents ≤200. Over the cap you _extract_ into a
file that does one thing. ⛔ You do not delete comments to fit — the comments are the
expensive part.

## Git hooks

`bun install` installs them (husky, via `prepare`). One script per concern, in
`scripts/hooks/`:

| hook       | runs                                                                                      | why                         |
| ---------- | ----------------------------------------------------------------------------------------- | --------------------------- |
| pre-commit | `secrets` → `foreign-locks` → **shared format/lint** → `actionlint` → `changeset-pending` | fast, staged files only     |
| pre-push   | `verify`                                                                                  | the same gate CI runs, ~30s |

★ **The format/lint step is not kit's.** It lives in `@homeflare/config/hooks` and every
repo in the estate runs the same one. Change the rule there, not here; the scripts
either side of it are concerns only this repo has. ⚠️ This repo calls it by its
workspace path (`packages/config/bin/hooks.ts`) because nothing here depends on the
package, so Bun links no copy into `node_modules` — every other repo uses
`node_modules/@homeflare/config/bin/hooks.ts`.

⚠️ **That step rewrites staged files.** It runs `oxfmt` over the staged formattable
files, names the ones it changed, and restages exactly those. A file with unstaged edits
on top is checked and never rewritten — restaging it would commit work in progress.

⛔ **pre-push here runs `verify`, not `check`.** Kit's `verify` adds the consumer smoke
test, which is the only gate that catches a tarball consumers cannot install. Elsewhere
in the estate the shared pre-push runs `bun run check`; it never guesses at `verify`,
because in `homeflare-proxmox` that name means a live adoption verifier.

⛔ **Secrets are scanned first**, by [gitleaks](https://github.com/gitleaks/gitleaks).
Everything else can be fixed after the fact; a credential in a public repo is compromised
the moment it is pushed.

⚠️ **gitleaks is a Go binary, not an npm package** — `brew install gitleaks`, or a
[release binary](https://github.com/gitleaks/gitleaks/releases) on Linux. The hook fails
loudly if it is missing rather than skipping: a secret scan that quietly does nothing is
worse than none, because it reads as coverage.

⚠️ **actionlint is also a Go binary** (`brew install actionlint`), but unlike gitleaks the
hook SKIPS when it is missing rather than failing. The asymmetry is deliberate: a missed
workflow typo costs one red CI run; a missed secret costs a rotation. CI runs actionlint
unconditionally either way.
⛔ The npm package named `actionlint` is an unrelated wasm port with no binary — measured
2026-09-15. The real tool is [rhysd/actionlint](https://github.com/rhysd/actionlint).

★ `--no-verify` exists and is occasionally right. It skips the secret scan too, so prefer
fixing the thing it is complaining about.

## The gates, and why each one exists

| gate            | catches                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `bun run lint`  | formatting and lint drift (oxfmt + oxlint)                                  |
| `bun run types` | ⚠️ tests can pass while failing to typecheck — this has happened here       |
| `bun run build` | must run **before** tests: the dist guard skips itself if `dist/` is absent |
| `bun test`      | behaviour, plus `tests/dist.test.ts` against the built bundle               |
| `bun run smoke` | packs the real tarball, installs it, runs it under **bun and node**         |

⚠️ **Why the smoke test is not optional.** Measured 2026-09-15: `"sideEffects": false`
made `bun build` emit a 126-byte `dist/index.js` containing only the export _names_, with
every module body tree-shaken away. It bundled without error, the tests passed, and `tsc`
emitted correct declarations. Every gate was green and the tarball was unusable. Only
importing the built artifact caught it.

## Releasing

Maintainers only, and mostly automatic: merging to `main` opens a **Version Packages**
PR; merging _that_ publishes to npm with provenance. Never bump a version by hand, and
never edit `src/version.ts` — it is generated by `scripts/sync-versions.ts`.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](./SECURITY.md).

## Reporting a gap

⛔ **Do not hand-roll a local version and move on.** That is how thirty-seven repos end
up with thirty-seven answers to the same question.

1. **Check whether a known SDK already does it well.** Adopting one is the preferred
   answer, not a fallback — this kit uses `ky`, `jose`, `zod` and Kumo rather than
   reimplementing them.
2. **If it genuinely belongs in the kit**, write the smallest thing that unblocks you,
   leave a marker, and report it:

```ts
// TODO(@homeflare/kit): retry-with-jitter belongs in the kit, not here.
```

Report back in this shape, so it needs no round-trip:

```
MISSING FROM @homeflare/*
- Package:   kit (runtime-neutral) | cloudflare (Workers) | ui | config
- Need:      one sentence
- Repeated:  how many places you have written this, here and elsewhere
- Existing:  the SDK that does it, with its dependency weight — or "nothing suitable"
- Instead:   what you did locally, or "blocked"
- API:       the call site as you would want to write it
```

Also report a function that **exists but is the wrong shape** — a bad API everyone works
around is more expensive than a missing one.

⚠️ **Version conflicts count as missing.** If a pinned version above fights this
project's needs, report it rather than overriding locally: a silent override becomes
drift that surfaces months later in someone else's build.
