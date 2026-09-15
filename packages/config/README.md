# @homeflare/config

Shared TypeScript, oxlint and oxfmt configuration. One place to change a rule, rather
than one copy per repo that drifts.

```sh
bun add -D @homeflare/config
```

## tsconfig

```jsonc
// an app or a Worker
{ "extends": "@homeflare/config/tsconfig.base.json" }

// a package that publishes types
{ "extends": "@homeflare/config/tsconfig.lib.json" }
```

`tsconfig.lib.json` adds `isolatedDeclarations` and `declaration` on top of the base.
⛔ Both are needed together — `isolatedDeclarations` alone is TS5069, even under
`--noEmit`.

The base turns on `strict`, plus the three flags that catch the most runtime bugs:
`noUncheckedIndexedAccess` (`arr[0]` is `T | undefined`), `exactOptionalPropertyTypes`,
and `noFallthroughCasesInSwitch`.

## oxlint

```json
{ "extends": ["./node_modules/@homeflare/config/oxlintrc.json"] }
```

⚠️ oxlint's `extends` takes **file paths**, not package names — there is no
`eslint-config-*` style resolution, so the path into `node_modules` is written out.

## oxfmt

```sh
cp node_modules/@homeflare/config/oxfmtrc.json .oxfmtrc.json
```

⚠️ The file must be named `.oxfmtrc.json` — **with the leading dot**. Without it oxfmt
silently uses its defaults, and the symptom is a formatter that rewrites your quotes.

## License

MIT © Timothy Schneider
