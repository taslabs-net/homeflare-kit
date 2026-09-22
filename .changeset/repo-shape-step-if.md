---
'@homeflare/config': minor
---

`JobStep` takes an `if:` condition, and homeflare-kit renders its own tooling from
`repo-shape.ts`.

The kit was the one repository the renderer had never been pointed at, and pointing it
there found the gap immediately: kit's `consumer smoke test` ends with a step that prints
the packed tarball sizes onto the run summary, and it carries `if: always()` because a
FAILED smoke test is exactly when those sizes are worth reading. The two ways to adopt
without this field were both worse — drop the condition and lose the summary on the only
runs that need it, or `except('.github/workflows/ci.yml')` and lose the drift guarantee on
the file for one repository's sake. Widening gives all fourteen the same freedom, which is
the order of preference the module already documents.

The emitter now writes `name:`, then `if:`, then the body, and the dash attaches to
whichever of those comes first, so an unnamed unconditional step renders exactly as before
(asserted by parsing the result, not by matching a substring).

Adopting it in the kit also moved one guarantee to where it now lives: `tests/workflows.test.ts`
read "build before test" out of ci.yml's step list, and the rendered job has one step —
`bun run check`. That assertion now reads `package.json`'s `check` script, which is both
where the ordering is decided and what a person runs locally, and a second test pins the
ci job to exactly `bun install --frozen-lockfile` and `bun run check` so the lanes cannot
quietly be copied back into the workflow.

Rendering kit's files also picked up the estate fixes it had been missing:
`gitleaks-action@v2` → `@v3` (GitHub removed the Node 20 runtime v2 needs), the absent
`pull-requests: read` permission without which every pull-request secret scan fails 403,
and the `@changesets/config` `$schema` pin at 4.0.1. Job names and the two required check
contexts — `ci` and `secret scan` — are byte-identical to what ran before.
