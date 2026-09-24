# Google Workspace — `@homeflare/alchemy/google-workspace`

Four Admin SDK Directory objects: `Group`, `GroupMember`, `DomainAlias`, `OrgUnit`. Built on
`@distilled.cloud/google-workspace@1.0.0-rc.12`'s `admin_directory_v1` service (S23) — every call
is one of its typed operations, every error a `catchTag`.

## Credential setup Tim needs

⛔ **The distilled SDK takes one thing: an already-minted OAuth2 bearer access token.** Its
`Credentials` service (`@distilled.cloud/google-workspace/Credentials`) has no service-account
JSON shape and no domain-wide-delegation (DWD) JWT exchange — read at the installed package,
2026-09-24: "API-compatible port of the distilled gcp credentials module … no ADC, no
service-account signing, no refresh flow". Minting the token is entirely outside the SDK.

★ **So this follows the house's existing pattern (H8), unchanged.** A Bun wrapper — the same
shape the kit's Proxmox subpath already uses for its own OpenBao-sourced token — mints a
short-lived token and exports it into the DEPLOY PROCESS's environment only:

| variable              | holds                                                                |
| --------------------- | -------------------------------------------------------------------- |
| `GOOGLE_ACCESS_TOKEN` | a short-lived OAuth2 bearer token, delegated to a Workspace admin    |
| `GOOGLE_PROJECT_ID`   | optional — only if a future resource needs to scope to a GCP project |

This package does not write that wrapper. `credentials.ts` exports `GoogleWorkspaceKeyRef` — a
typed REFERENCE (an OpenBao path, the delegated admin, the scopes) a stack file can keep next to
its declarations for review, and `describeKeyRef()` to render it as one line of text. Neither
holds, reads or accepts anything shaped like a key (`credentials.test.ts` asserts the refusal).

### What Tim has to set up, once

1. **A service account** in a Google Cloud project linked to the Workspace account, with
   **domain-wide delegation** enabled in the Admin console (Security → API controls →
   Domain-wide delegation) for the service account's client ID.
2. **The least OAuth scopes the four resources need** — grant exactly these, nothing broader:

   | resource               | scope                                                     |
   | ---------------------- | --------------------------------------------------------- |
   | `Group`, `GroupMember` | `https://www.googleapis.com/auth/admin.directory.group`   |
   | `DomainAlias`          | `https://www.googleapis.com/auth/admin.directory.domain`  |
   | `OrgUnit`              | `https://www.googleapis.com/auth/admin.directory.orgunit` |

   `admin.directory.group` covers group **and** member CRUD — Google does not split them further
   without also losing group create/update. A credential that only ever manages membership (never
   creates or edits a group) can narrow to `admin.directory.group.member` instead.

3. **The service account's key** goes in OpenBao, never on disk in this repo or anywhere a stack
   file can reach: `kv/google-workspace/service-accounts/<name>`, matching the mount/catalog
   pattern in `~/.claude/AGENTS.md`'s Cloudflare-credential section (same "mint, never reuse"
   posture, different vendor).
4. **The wrapper** reads that key from OpenBao, performs the DWD JWT-bearer exchange
   (`https://oauth2.googleapis.com/token`, `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`,
   `sub` = the delegated admin) for a token scoped to exactly the table above, and exports it as
   `GOOGLE_ACCESS_TOKEN` before `alchemy.run.ts` runs — never printed, never logged, never written
   to a file. This is the one piece this PR does not build; see
   [upstream-conformance.md](./upstream-conformance.md) for why (S23: distilled owns the SDK
   surface, the house owns minting, and the two should not be re-blended into a second hand-rolled
   auth flow).

### Read-only credential, for the census handoff

The handoff script at `scratchpad/handoffs/23-workspace-census.sh` only lists — it never writes.
Mint it a SEPARATE, narrower credential: `admin.directory.group.readonly`,
`admin.directory.domain.readonly`, `admin.directory.orgunit.readonly`. Do not reuse the write
credential above for a read-only script.

## Adopt is the default posture

`reconcile` fetches by key (email, alias name, or org unit path) before it writes — no NetBox-style
list-then-disambiguate, because every object here has a stable key a human would type. An
instance that already has "Schenanigans - Admin" or "Schenanigans - Google" (the groups the
estate's Cloudflare Access policies already name — `docs/zero-trust-access-applications.md` in
homeflare-landscape) is BOUND, never duplicated, and `attributes` always maps the FULL live row —
the exact-as-live half of `adopt(true)`.

## Users are out of scope

`GoogleWorkspace.User` is not built. `insertUsers`/`patchUsers` accept a `password` field on the
wire — one keystroke from becoming a prop, and Alchemy persists props unencrypted. No stack in
this estate declares a Workspace user today (measured 2026-09-24). `GroupMember.email` references
a user without ever creating, reading or storing one.

## Removal is `retain` for everything but membership

`Group`, `DomainAlias` and `OrgUnit` default to `retain` — each governs something else (Access
policies, mail routing, service visibility) that outlives the declaration removing it.
`GroupMember` does not: adding someone back to a group is cheap and reversible, so it uses the
engine default (`destroy`).

## SDK gaps, measured 2026-09-24

- **`admin_directory_v1` lives under `unstable/`, not the SDK's preferred `services/` tree**
  (`@distilled.cloud/google-workspace/unstable/admin_directory_v1`). The package's own `index.ts`
  says "non-preferred versions" — this is the only Directory API version distilled generates, so
  "non-preferred" describes distilled's own service catalog, not a deprecated Google API. Nothing
  about the operations this family calls looked incomplete or wrong; flagged here per S23/S33 so a
  future upgrade that moves it to `services/` is a one-line import change, not a surprise.
- **No per-operation typed error beyond the shared `NotFound | Forbidden | BadRequest | Conflict`
  set.** A cycle in group membership, an unverified domain on `insertDomainAliases`, or a
  reparent-with-children refusal on `deleteOrgunits` all surface as `BadRequest` with a message,
  not a resource-specific tag. S21 says a missing tag is fixed in the SDK, never worked around in
  the resource — none of these three cases are worked around here; they propagate as `BadRequest`
  same as any other 400.
- **No `updateGroupsAliases`/`patchGroupsAliases`.** Group aliases are add/list/delete only,
  matching `DomainAlias`'s own no-update shape — not modelled as a fifth resource in this PR
  (out of scope: the task named domain aliases, not group aliases).
