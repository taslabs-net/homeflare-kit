# Retired rendered files — the fossil, and how it is cleared

`renderRepoShape` only emits the files a shape asks for today. `refreshRepoShape` only
writes what it renders. Put those two together and a file the renderer stops emitting is
never deleted by a refresh — it just stops being updated, silently, in every repository
that had already taken it. `RETIRED_FILES` in `src/repo-shape/retired.ts` is how that stops
being permanent.

## MEASURED 2026-09-24: the gap that motivated this

`@homeflare/config` 0.12.0 ([kit PR 199](https://github.com/taslabs-net/homeflare-kit/pull/199))
stopped rendering `.github/workflows/dependabot-automerge.yml` — `taslabs-net/homeflare-bumper`
carries a kit release into a consumer now, over `workflow_dispatch`, so the workflow that used
to arm auto-merge on Dependabot's `homeflare` group had nothing left to do.

Every repository that had already refreshed to 0.12.0 before this module existed
(`homeflare-wiki` bump PR 19, `homeflare-mini` bump PR 47) kept the dead file. Nothing said
so: `driftInRepoShape` only ever compared the paths the **current** shape renders, and a
retired path is not one of those, so it was invisible to the one check whose whole job is
to say when a committed file and the renderer disagree.

## The two halves

**`driftInRepoShape` (`repo-shape check`) reports a retired path that is merely present.**
It does not read the file to decide anything beyond "is it there" — proving the file is
provably ours is `refreshRepoShape`'s decision to make, not the read-only check's. So
`bun run repo-shape:refresh` fails on a retired fossil exactly the way it fails on ordinary
drift:

```
✗ .github/workflows/dependabot-automerge.yml: retired in @homeflare/config@0.12.0
  (kit PR 199 retired the Dependabot @homeflare group; taslabs-net/homeflare-bumper carries
  a kit release into each consumer now, over the kit's own release workflow) but still
  present — run `bun run repo-shape:refresh` to remove it
```

**`refreshRepoShape` deletes a retired path only when it can prove it rendered it.** The
proof is the generated-file header: every renderer in `src/repo-shape/` writes
`🤖 RENDERED BY @homeflare/config` into the file it emits, and `wasRenderedByUs` is nothing
more than a check for that line. A retired path whose content carries it is deleted. A
retired path whose content does not — a hand-written replacement, a fork of the old
rendered file kept on purpose, or coincidental content that landed at the same name — is
left exactly as it is, and reported back as `refused`, never `removed`.

⚠️ **A refused file still fails `repo-shape check`.** The check does not know or care
whether the file is provably ours; it only knows the retired path is present. There is no
`except()` for a retired path — a repository that genuinely wants to keep a hand-written
file at that exact name has to remove it or rename it itself; `repo-shape` will not delete
someone else's file to make its own check pass.

## Why the header, not a stored copy of the old rendered text

The retired `dependabot-automerge.yml` varied by `shape.runner` and by repository name —
there is no single byte-for-byte "the rendered form" to compare against across the estate's
history, and a renderer that has been deleted cannot be asked to re-render its old output.
The header line is the one thing every variant, in every repository, always carried.

## Retiring a path, going forward

Add an entry to `RETIRED_FILES` in `src/repo-shape/retired.ts`: the path, the
`@homeflare/config` version whose release stops rendering it, and a written reason — same
rule as `except()`, enforced the same way. Remove the path from `render.ts` in the same
changeset. A path can never move back into `RenderedPath`; `repo-shape-retired.test.ts`
asserts the two lists stay disjoint, because a path in both would have the renderer writing
a file this module is also trying to delete, every single refresh.

## How this reaches a consumer

A patch release of `@homeflare/config` ships the new `RETIRED_FILES` entry.
`taslabs-net/homeflare-bumper` opens the bump pull request in each consumer the way it
always does. Its own `bun run repo-shape:refresh` — the same step every bump PR already
needs, [documented here](./repo-shape.md#bumping-homeflareconfig-will-go-red-before-it-goes-green) — now also deletes
the fossil, so the PR's diff touches `.github/workflows/`. **The bumper holds a PR that
touches that directory for Tim rather than auto-merging it**, which is the correct,
existing behavior for a workflow-file change — not something this module has to arrange.
