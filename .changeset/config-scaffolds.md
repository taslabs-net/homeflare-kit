---
'@homeflare/config': minor
---

Make the config strong enough to scaffold a real project, and able to catch drift.

**The preset was weaker than the estate it was meant to standardise.** It carried 4 rules
and 4 plugins against the monorepo's 36 rules and 6 plugins — so adopting it would have
been a downgrade. It now carries the full set, including `react` and `jsx-a11y`.

★ Adopting them immediately corrected three files in this repo (`sort-imports`,
`prefer-template`), and this repo now lints itself **with its own preset** — a config the
publisher does not obey is a config nothing proves.

**New: `bunfig.toml`** — exact installs, cache on, coverage reported per project.

**New: `@homeflare/config/check`** — a conformance check a project runs against itself:

```ts
import { checkProject } from '@homeflare/config/check';
expect(await checkProject(process.cwd())).toEqual([]);
```

⛔ `.oxfmtrc.json` and `bunfig.toml` have no `extends`, so adopting them means _copying_
them — and a copy drifts silently. This reports what differs. It never repairs: it cannot
tell drift from a deliberate local exception.

⚠️ Parses natively (`Bun.file().json()`, `Bun.TOML.parse`) with a string-aware JSONC strip,
so no parsing dependency reaches a consumer — and a tsconfig keeps its comments, which is
where the reasoning for a strict flag lives.
