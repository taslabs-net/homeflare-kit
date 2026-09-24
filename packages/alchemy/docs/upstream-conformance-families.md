# Upstream conformance: remaining family findings

Status: extracted from the [conformance ledger](./upstream-conformance.md); its dated
measurements and open findings are preserved below.

7. **`proxmox/*` is the model for S38.** Its types and constraints are generated from the
   vendor schema, and a manifest records the version and sha256. It diverges in four ways:
   - the generic factory's `read` returns plain attributes, so every family except `Lxc`
     adopts silently, against the house's own H1;
   - 27 `Effect.die` sites in non-test source (defect risk, not a separate S20 ban);
   - 7 test files on `node:test`;
   - `Pbs.*` type strings (H14).
8. **`talos/*`.** Its `talosctl` calls go through `ChildProcessSpawner`, as upstream's Docker
   provider does, which conforms. Its file handling uses `Bun.file`, `Bun.write`,
   `Bun.YAML` and `node:fs` (S42), and it uses `Effect.promise` in 3 files (S19). The
   kubeconfig it writes is meant to be consumed through upstream's
   `Kubernetes.KubeConfig({ path })`.
9. **`netbox/*` conforms mostly.** Its constraints are generated from NetBox 4.7.0's
   OpenAPI. Adopting first is documented as deliberate.
   - ✅ **S23 fixed 2026-09-23** (branch `claude2/distilled-netbox-family`, mirroring the
     Forgejo migration above, decision 42). `Netbox.Prefix` now calls
     `@distilled.cloud/netbox`'s typed `ipam` operations instead of a hand-rolled `Effect
HttpClient` client. The old status-carrying `NetboxError` and its `cause.status ===
404` check are gone entirely — `Netbox.Prefix` locates by a server-side list filter,
     which never 404s (an empty page is a normal 200), so nothing here checks a status
     code at all, a stronger form of the same rule `catchTag('NotFound', …)` enforces for
     a family that reads by direct key. `client.ts` is deleted. Not published upstream
     yet, so aliased onto `@homeflare/distilled-netbox@0.2.0` as a plain `dependencies`
     entry, not a peer — [distilled-interim.md](./distilled-interim.md). State did not
     move: props/attributes stay byte-identical, proven by the family's unchanged
     existing tests plus new tests against a fake NetBox exercising the real distilled
     protocol.
   - ⛔ **Still diverges on credentials (S24):** `NETBOX_TOKEN` / `NETBOX_URL` are read at
     call time, now through the SDK's `CredentialsFromEnv` rather than a hand-rolled
     `token()` — same divergence, unchanged by the transport swap.
10. **`litellm/*` has no upstream equivalent** (LiteLLM has no upstream Alchemy family, the
    same situation `openbao/*` is in above), and conforms on the transport contract.
    - ✅ **S23 fixed 2026-09-24** (branch `claude2/litellm-distilled`, mirroring the NetBox
      migration above, decision 43). `LiteLLM.PassThroughEndpoint` now calls
      `@distilled.cloud/litellm`'s typed `misc` operations (`operations.ts`) instead of a
      hand-rolled `Effect HttpClient` client. The old status-carrying `LitellmBadRequestError`
      family is gone: every failure the four operations declare (`BadRequest`, `NotFound` on
      update, `UnprocessableEntity`, plus the shared `Unauthorized`/`TooManyRequests`/server
      errors) is the SDK's own typed error, `catchTag`'d — `deletePassThroughEndpoint`'s
      re-list-on-ambiguous-`BadRequest` trick (S21: a status-and-a-real-read decision, never
      body text) is unchanged, now keyed on the tag instead of the status code. The
      per-base-URL write semaphore this vendor's whole-list storage forces (docs/litellm.md)
      is unchanged too — the SDK has no opinion on it, so it stays one layer above the typed
      calls, in `operations.ts`. `client.ts` and the kit's own hand-generated
      `generated/pass-through.ts` are both deleted (the SDK's `misc.PassThroughGenericEndpoint`
      is the same shape, generated from the same LiteLLM 1.100.0 OpenAPI document — see
      `codegen/manifest.json`'s `litellm-openapi` entry, left in place and unconsumed rather
      than deleted, the same pattern the two UniFi entries already establish). Not published
      upstream yet, so aliased onto `@homeflare/distilled-litellm@0.2.0` as a plain
      `dependencies` entry, not a peer — [distilled-interim.md](./distilled-interim.md). State
      did not move: props/attributes stay byte-identical, proven by the family's unchanged
      existing tests (now against a fake LiteLLM exercising the real distilled protocol
      through `FetchHttpClient.Fetch`, not a loopback `Bun.serve`) plus the engine-level
      replace test through `fake-stack.ts`. No stack in this estate currently imports
      `litellmProviders`/`LiteLLM.PassThroughEndpoint` (measured 2026-09-24 across
      homeflare-landscape's own repositories, including this one's `stacks/`), so there is no
      live plan to re-run.
    - ⛔ **Still diverges on credentials (S24):** `LITELLM_PROXY_URL` / `LITELLM_PROXY_API_KEY`
      are read at call time, now through the SDK's `CredentialsFromEnv` rather than a
      hand-rolled `resolveCreds` — same divergence, unchanged by the transport swap.
    - **Credentials resolution, decision 49 (2026-09-24):** the temporary typed-`ConfigError`
      change was reverted in [PR #261](https://github.com/taslabs-net/homeflare-kit/pull/261).
      `CredentialsFromEnv` retains distilled's own `Effect.orDie` convention. S20 forbids it
      in lifecycle operations; it is not a separate credentials-layer prohibition. The same
      shape in NetBox is therefore not an S20 follow-up. See [LiteLLM's Q6 resolution](./litellm.md#credentials).
11. **Every family repeats `list: () => Effect.succeed([])`**, 30 times, and only
    `R2BucketLock` and `MeshNode` declare `nuke`. The constructor already defaults `list`
    (S12). **Fix:** write the reason where it differs, and declare `nuke: { skip: true }`
    where nuke must never reach the object.
12. **Resource JSDoc is not in upstream's generator format.** Zero files use `@resource`,
    `**Example:**` or `### Section` (S31, H10). **Decision:** maintainer, because it moves
    the house's glyph rationale into `//` comments.
13. **Tests never use `alchemy/Test/Bun`.** Every lifecycle is proven against loopback
    fakes (S28, H12). Live suites need a place to run, and that is a maintainer decision.
14. **`discord/*` is new (2026-09-24, task-authorized, kit PR TBD) and built directly on
    `@distilled.cloud/discord` — no hand-rolled `client.ts` ever existed to retire.**
    `Discord.ApplicationCommand` and `Discord.GuildApplicationCommand` call the SDK's
    typed operations, `catchTag`'d through the shared `DiscordOpError` union (S21), with no
    status sniffing anywhere in `resource.ts`. It follows upstream's `Snippet.ts` reference
    exactly for a marker-less API (S7, S8): a cold `read` returns `Unowned(attrs)`, and both
    convenience constructors pipe `adopt(true)` (H5) — a stricter posture than `netbox/*`'s
    documented H1 gap, not a repeat of it. Rate-limit handling is the SDK's own default
    `Retry` policy (bounded: `Schedule.recurs(8)`, S26) — this family adds nothing on top.
    Full detail, the live Halibut census and its ownership-handover sequence, and every SDK
    gap: [`discord.md`](./discord.md). ⛔ **Diverges on S24/S25 the same way every distilled
    family in this ledger does:** credentials are read at call time through the SDK's own
    `CredentialsFromEnv`, not a house `alchemy/Auth` provider — unchanged from `netbox/*`
    and `litellm/*`'s entries above. **Gap, not yet fixed:** no vendor constraint table
    (unlike NetBox/Paperless); `options` passed through opaquely rather than modeled from
    the schema (`docs/discord.md#sdk-gaps`).
