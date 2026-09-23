# The estate version set: `@homeflare/config/versions`

Status: published source. Not yet enforced anywhere outside the kit. Verified 2026-09-22.

```ts
import { ESTATE_VERSIONS } from '@homeflare/config/versions';

ESTATE_VERSIONS.alchemy; // '2.0.0-beta.79'
ESTATE_VERSIONS.bun; // '1.4.0', the same value as BUN_VERSION in ./repo-shape
```

| package                       | version             | why this one                                               |
| ----------------------------- | ------------------- | ---------------------------------------------------------- |
| `bun`                         | `1.4.0`             | the value every rendered CI installs (`BUN_VERSION`)       |
| `alchemy`                     | `2.0.0-beta.79`     | the newest release on npm when this was written            |
| `effect`                      | `4.0.0-rc.115`      | what that alchemy release overrides its whole workspace to |
| `@distilled.cloud/cloudflare` | `1.0.0-rc.12`       | what that alchemy release depends on, exactly              |
| `typescript`                  | `7.0.2`             | the kit catalog                                            |
| `oxfmt` / `oxlint`            | `0.68.0` / `1.83.0` | the kit catalog; ahead of upstream's `^0.66.0` / `^1.82.0` |
| `@types/bun`                  | `1.4.2`             | matches `bun`                                              |

## Where the truth lives

⛔ **The kit's root `catalog` is the source, and this export is its published copy.** Before
this export existed, the pins were written in two places. Bun was `BUN_VERSION` in
`./repo-shape`. Everything else sat in the kit's root `catalog`, which is never published.
So no other repository had anything to compare its lockfile against.
`tests/estate-versions.test.ts` in the kit fails whenever a value here differs from the
catalog, from the root `overrides`, from `packageManager`, or from what the installed
`alchemy` itself depends on. A bump therefore changes both in one PR, or it goes red.

★ **Runtime pins follow `alchemy`.** `effect` and `@distilled.cloud/*` are whatever the
pinned `alchemy` release was built and tested against. They move in the PR that bumps
`alchemy`, never ahead of it. Upstream `main` already runs `effect` rc.117. That is not a
reason to move until a release carries it.

## What drifts today

The kit's `alchemy-provider-standard` audit measured each estate repository's lockfile
read-only on 2026-09-22:

- Seven app repositories resolve `alchemy` 2.0.0-beta.78.
- The monorepo resolves beta.77, with `effect` rc.112, distilled rc.9, oxfmt 0.66.0 and
  oxlint 1.81.0, and installs with pnpm.
- One app resolves TypeScript 5.9.3.
- Every consumer resolves an older `@homeflare/config` than the one published.

⚠️ **This export compares nothing on its own.** Adding a lockfile check to `checkProject`,
so that every repository fails on drift, is a separate estate-wide rollout. It has to land
together with the bumps it would demand. Otherwise every CI goes red on the same day.
