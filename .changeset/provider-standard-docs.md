---
'@homeflare/alchemy': patch
---

Two new docs, and no code change.

`docs/provider-standard.md` is the kit-side statement of the house standard for a custom
Alchemy provider. It keeps the standard's rule numbers, and each rule is cited upstream at
`alchemy@2.0.0-beta.79`. It covers four things. First, use upstream's resource when one
exists. Second, route every vendor call through `@distilled.cloud/<vendor>` when that
package exists. Third, use Alchemy's own helpers (`alchemy/Util/sha256`, `Util/poll`,
`Util/AtomicFile`, `Diff`, `Tags`, `PhysicalName`, `AdoptPolicy`, `Auth` and `Test/Bun`)
rather than house copies. Fourth, keep `src/**` provider code runtime-portable, because
this package builds with `--target node`, while tests, fakes, scripts and codegen stay
Bun-native. The page also records, per family, the vendor version each one was walked
against and where that record lives. Six families record it only in prose.

`docs/upstream-conformance.md` is the audit of every family against that standard, as a
ranked ledger. It was measured read-only on `925454b`. The findings, in rank order:

1. `R2BucketLock` uses `Effect.orDie` and `Effect.promise`. Its reconcile trusts `output`
   rather than the live lock, and it sits on a second Cloudflare SDK where
   `@distilled.cloud/cloudflare/r2` already has the lock operations.
2. `forgejo/client.ts` is hand-rolled, while `@distilled.cloud/forgejo@1.0.0-rc.12` is
   generated against Forgejo 16.0.3.
3. `MeshNode` is a deliberate twin of `Cloudflare.Tunnel.WarpConnector`.
4. Shipped provider code calls `Bun.*` or `node:*` unguarded (17 files), and 51 test files
   run on `node:test` instead of `bun:test`.

What the ledger records is the gap for each finding. It changes nothing.
