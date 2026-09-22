## What and why

<!-- What changes for a consumer of the published package, and why. -->

## Changeset

<!-- ⛔ A PR that changes published behaviour needs one, or it will not release:
     the version PR is generated from these files, so a missing one is a silent no-op.
     Run `bun run changeset`. Tick the second box for docs/CI-only changes. -->

- [ ] `bun run changeset` — added, and describes the change in the user's terms
- [ ] Not needed: this changes nothing a consumer installs

## Checks

- [ ] `bun run verify` passes locally (lint · types · build · tests · consumer smoke)
- [ ] `@homeflare/kit` still imports no `bun:*`, `node:*`, or filesystem
- [ ] New exported symbols carry explicit types (`isolatedDeclarations` enforces it)
- [ ] Any new dependency is justified in the description — a known SDK beats hand-rolling,
      and both beat a dependency that does not earn its weight
