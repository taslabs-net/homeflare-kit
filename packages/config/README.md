# @homeflare/config

Shared TypeScript, oxlint and oxfmt configuration for HomeFlare projects. One place to
change a rule, rather than one copy per repo that drifts.

## tsconfig

```jsonc
// tsconfig.json — an app or a Worker
{ "extends": "@homeflare/config/tsconfig.base.json" }

// tsconfig.json — a package that publishes types
{ "extends": "@homeflare/config/tsconfig.lib.json" }
```

`tsconfig.lib.json` adds `isolatedDeclarations` and `declaration` on top of the base.
⛔ Both are needed together — `isolatedDeclarations` alone is TS5069, even under
`--noEmit`.

## oxlint

⚠️ oxlint's `extends` takes **file paths**, not package names — there is no
`eslint-config-*` style resolution. The path into `node_modules` is written out:

```json
{
  "extends": ["./node_modules/@homeflare/config/oxlintrc.json"],
  "rules": {
    // project-specific overrides go here
  }
}
```

## oxfmt

⚠️ The file must be named `.oxfmtrc.json` — with the leading dot. Without it, oxfmt
silently uses its defaults, and the symptom is a formatter that rewrites your quotes.

```sh
cp node_modules/@homeflare/config/oxfmtrc.json .oxfmtrc.json
```

## License

MIT © Timothy Schneider
