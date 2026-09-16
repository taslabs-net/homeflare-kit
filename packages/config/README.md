# @homeflare/config

The HomeFlare toolchain, as configuration. One place to change a rule, rather than one
copy per repo that drifts.

```sh
bun add -D @homeflare/config
```

## What it gives you

| file                 | how to use it                                    |
| -------------------- | ------------------------------------------------ |
| `tsconfig.base.json` | `extends` — owned code, full strictness          |
| `tsconfig.app.json`  | `extends` — Worker apps (source-publishing deps) |
| `tsconfig.lib.json`  | `extends` — packages that publish types          |
| `oxlintrc.json`      | `extends` — libraries                            |
| `oxlintrc.app.json`  | `extends` — Worker / TanStack / Alchemy apps     |
| `oxfmtrc.json`       | copy to `.oxfmtrc.json`                          |
| `bunfig.toml`        | copy to `bunfig.toml`                            |

## tsconfig

```jsonc
// a Worker or app that imports packages publishing .ts (not .d.ts)
{ "extends": "@homeflare/config/tsconfig.app.json" }

// owned library code — the full baseline
{ "extends": "@homeflare/config/tsconfig.base.json" }

// a package that publishes types
{ "extends": "@homeflare/config/tsconfig.lib.json" }
```

`tsconfig.lib.json` adds `isolatedDeclarations` and `declaration`. ⛔ Both are needed
together — `isolatedDeclarations` alone is TS5069, even under `--noEmit`.

The base turns on `strict` plus the flags that catch the most runtime bugs:
`noUncheckedIndexedAccess` (`arr[0]` is `T | undefined`), `exactOptionalPropertyTypes`,
and `noFallthroughCasesInSwitch`.

⚠️ **`tsconfig.app.json` turns three of those off.** `skipLibCheck` only skips `.d.ts`.
Measured 2026-09-16: `@cloudflare/ci@0.2.0` ships `"types": "./src/index.ts"`, and Better
Auth plugin types do the same. Those files typecheck under _your_ flags, so the strict
baseline fails the consumer. Use the app preset there; keep `base` / `lib` for code you
own. Override the flags back on in a project that does not import source-publishing deps.

## oxlint

```json
{ "extends": ["./node_modules/@homeflare/config/oxlintrc.json"] }
```

A Worker, TanStack Start, or Alchemy app:

```json
{ "extends": ["./node_modules/@homeflare/config/oxlintrc.app.json"] }
```

⚠️ oxlint's `extends` takes **file paths**, not package names — there is no
`eslint-config-*` style resolution, so the path into `node_modules` is written out.

The library preset is 36 rules across `typescript`, `unicorn`, `oxc`, `import`, `react`
and `jsx-a11y`. The app preset extends it and turns off the collisions `--deny-warnings`
hits on correct Worker/app code (measured 2026-09-16):

- `no-console` off under `src/` — `console` _is_ Workers Logs.
- `import/no-default-export` off — Alchemy, `Worker`, and TanStack entry files export
  default.
- `jsx-a11y/control-has-associated-label` off — Kumo initials triggers are labelled by
  the design system, not a `htmlFor`.
- `typescript/no-non-null-assertion` off in tests.

⛔ Do not copy the library preset into an app and then disable those one by one. That is
how every app grows a private oxlint.

## oxfmt and bunfig

```sh
cp node_modules/@homeflare/config/oxfmtrc.json .oxfmtrc.json
cp node_modules/@homeflare/config/bunfig.toml  bunfig.toml
```

⚠️ `.oxfmtrc.json` needs the **leading dot**. Without it oxfmt silently uses its defaults,
and the symptom is a formatter that rewrites your quotes.

⛔ oxfmt has no `extends`. Extra `ignorePatterns` are a **merge**: generated OpenAPI,
`vendor/`, `**/generated/**`, `**/*.gen.ts` stay out of the formatter. ⛔ Identity
comparison is the wrong gate — it rewrote 154 files to `singleQuote` and formatted
vendor OpenAPI (measured 2026-09-16). Dropping a house ignore is still drift.

`bunfig.toml` is still an exact copy.

## Keeping a project honest

```ts
import { checkProject } from '@homeflare/config/check';

const problems = await checkProject(process.cwd());
if (problems.length > 0) throw new Error(problems.join('\n'));
```

★ Run it from a test. It asserts a project still extends the shared tsconfig and oxlint
presets, that `.oxfmtrc.json` keeps house style plus at least the house ignores, and that
`bunfig.toml` still matches.

## License

MIT © Timothy Schneider
