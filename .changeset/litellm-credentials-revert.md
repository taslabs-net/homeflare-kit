---
'@homeflare/alchemy': patch
---

`@distilled.cloud/litellm` (interim, via `packages/distilled-litellm`): reverts `credentials.ts`
to `Effect.orDie` on a missing or misspelled `LITELLM_PROXY_URL`/`LITELLM_PROXY_API_KEY`.

Q6 of the 2026-09-24 walk-down (decision 49 "upstream wins"): distilled's own convention for a
missing credential is `Effect.orDie`, not a typed `ConfigError` — 73 of 80 `packages/*/src/credentials.ts`
end this way at `homeflare/base`, 78 of 80 at `origin/main`. A worktree commit (`4ad19154`) had
made LiteLLM's `Credentials` the one exception, declaring `Effect.Effect<Config, ConfigError>` and
dropping the `orDie`. Distilled is not silent on this convention, so the divergence was the house
going stricter than distilled's own practice on a point it already has an answer for — the thing
decision 49 says to stop doing. Reverted in the litellm worktree (`homeflare/litellm`
`cbd6bbb890066e57fb0224b96c27fca91d89e0a6`, a `git revert` of `4ad19154`, confirmed byte-identical
to `4ad19154`'s parent), gated on `typecheck:ci`/`specs:check`/`format:check`, then byte-copied
into `packages/distilled-litellm/src/credentials.ts` (confirmed with `diff -rq` against the
worktree's `src/`).

**The typed-error idea is not discarded**, just not spread further: it is written up as a HELD
upstream proposal in [`litellm.md`](../packages/alchemy/docs/litellm.md#credentials) — distilled's
own `LitellmOpError` already declares `ConfigError` and threads a real credentials failure into an
operation's error channel, so the plumbing for a typed refusal genuinely exists; nobody has raised
it to `alchemy-run/distilled`, and this PR doesn't either.

**`packages/alchemy/src/litellm/operations.ts`'s `mutate` helper needed no functional change.**
Its `| ConfigError` widening was always redundant with the operation-level `LitellmOpError` union
(which declares `ConfigError` unconditionally, regardless of `Credentials`'s own type) — confirmed
by re-reading `protocol.ts` — so it still typechecks and the widening is still a real no-op for
callers. Its comment is corrected: it no longer claims resolving `Credentials` can itself fail
typed, since post-revert it cannot.

**Verified**: `bun run build:interim-packages`, `tsc --noEmit` for the whole `@homeflare/alchemy`
package, `bun test src/litellm` (28/28), and `packages/distilled-litellm`'s own `types` and
`smoke` — all clean.

No live plan change: this only affects what happens when the two env vars are missing or
misspelled, which was never a state this family's tests exercised as "succeeds."
