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
| `oxlintrc.json`      | `extends` — 36 rules, 6 plugins                  |
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

⚠️ oxlint's `extends` takes **file paths**, not package names — there is no
`eslint-config-*` style resolution, so the path into `node_modules` is written out.

36 rules across `typescript`, `unicorn`, `oxc`, `import`, `react` and `jsx-a11y`. The ones
worth knowing:

- `no-console: error` — ⚠️ except where `console` _is_ the transport, as in a Worker
  writing JSON for Workers Logs. Override it per file, not globally.
- `typescript/no-non-null-assertion` — `!` hides exactly what `noUncheckedIndexedAccess`
  is trying to surface.
- `react/exhaustive-deps`, `jsx-a11y/click-events-have-key-events` — only bite in React
  code; a Worker never sees them.

## oxfmt and bunfig

```sh
cp node_modules/@homeflare/config/oxfmtrc.json .oxfmtrc.json
cp node_modules/@homeflare/config/bunfig.toml  bunfig.toml
```

⚠️ `.oxfmtrc.json` needs the **leading dot**. Without it oxfmt silently uses its defaults,
and the symptom is a formatter that rewrites your quotes.

⛔ Neither format supports `extends`, so these two are copies. That means they can drift —
which is what `@homeflare/config/check` exists to catch.

## Keeping a project honest

```ts
import { checkProject } from '@homeflare/config/check';

const problems = await checkProject(process.cwd());
if (problems.length > 0) throw new Error(problems.join('\n'));
```

★ Run it from a test. It asserts a project still extends the shared tsconfig and oxlint
presets, and that its copied `.oxfmtrc.json` and `bunfig.toml` still match — so a project
that quietly diverges fails its own suite rather than drifting for six months.

## License

MIT © Timothy Schneider
