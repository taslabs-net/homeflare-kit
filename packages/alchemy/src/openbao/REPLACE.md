# Replace semantics: the `Bao.*` providers

Audited 2026-09-21, against `alchemy@2.0.0-beta.79` and OpenBao v2.6.2 source. Every kit
provider must answer `replace` correctly (vault consolidation plan, "Replace freely").

## What Alchemy does with each answer

- **`update`**: `reconcile` runs against the same resource. Only safe when the object's identity
  (its path) is unchanged.
- **`replace`**: create-first by default. The new generation is created, dependents are updated in
  the same graph, then the old generation is deleted (`Apply.ts`, delete-first comment near :1180).
- **`deleteFirst: true`**: tears the old one down first. It is only for identities that cannot
  coexist, such as a unique physical name. No `Bao.*` provider needs it: every identity here is an
  API path, and a new path never collides with the old one.
- **`retain`**, the default for every `Bao.*` family, **keeps the old generation of a replace**
  (`Apply.ts:2164-2173`, "Retaining replaced resource"). ⚠️ So under the default, a replaced role
  **stays live** and still admits logins. Opt into `RemovalPolicy.destroy()` where that matters
  (per-host AppRoles), or remove it by hand.

## The bug class this audit found

⛔ **A changed identity planned `update`.** `diff` read the NEW path, found nothing, answered
`update`, and `reconcile` created the object at the new path. The old object stayed live with no
state record, so no later plan would mention it. For a mount this meant an **empty** new mount
beside the retained one that held every secret. For an AppRole it meant the old role's secret_ids
kept working for their whole TTL.

## Touched in this batch

| Resource                  | Identity change | Answer now                                                                                                                               | Other changes                                               |
| ------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Bao.Mount`               | `path`          | ⛔ **fails the plan**, unless `remountFrom` names the old path. Then it is an in-place `update` that moves the mount with `sys/remount`. | `type` → `replace`. Description and TTLs → `update` (tune). |
| `Bao.AuthMethod`          | `path`          | Same as `Bao.Mount` (`auth/` prefix). The accessor survives the move.                                                                    | `type` → `replace`                                          |
| `Bao.AuthRole`            | `name`          | `replace`. Before 2026-09-21 it was `update`, and the old role was orphaned.                                                             | `update`                                                    |
| `Bao.PkiRole`             | `mount`, `name` | `replace`. Before, only a `mount` change was caught; a `name` change orphaned the old role.                                              | `update` (full-replace write)                               |
| `Bao.JwtRole`             | `mount`, `name` | `replace`                                                                                                                                | `update` (merge write; every managed field is sent)         |
| `Bao.KubernetesRole`      | `mount`, `name` | `replace`                                                                                                                                | `update`                                                    |
| `Bao.JwtAuthConfig`       | `mount`         | `replace`. The old delete is a no-op because there is no delete endpoint.                                                                | `update` (full-replace write)                               |
| `Bao.MfaTotpMethod`       | `name`          | ⛔ **fails the plan**: a new id would strand every enrolled secret                                                                       | `update` (the upsert keeps the id)                          |
| `Bao.MfaLoginEnforcement` | `name`          | `replace`. Its delete is **refused** (openbao#4030)                                                                                      | `update`                                                    |

`hostAppRoles` makes no resources, but its names are identities: renaming a host or a class
renames the role, and `Bao.AuthRole` then plans a `replace`.

## Why the moves fail instead of replacing

- **Mount and auth path.** A `replace` would create an empty mount. Deleting the old one would
  destroy every secret, and with the default `retain` the data would be stranded. `sys/remount`
  is the only move that keeps the data: the mount keeps its UUID, and storage lives under the
  UUID (`vault/mount.go:630-735`). ⛔ It **revokes every lease** under the old path
  (`RevokePrefix`, :684), and it rewrites no policy that names the old path.
- **TOTP method name.** Every enrolled secret is keyed by the method id
  (`entity.MFASecrets[id]`). The safe rename adds a second method, lists both on the enforcement
  (any one passing is enough), enrols everyone, then drops the old method.

## The plan's three exceptions, mapped

1. **`retain` resources orphan the old generation on a replace.** That applies to all of the
   above. A mount is never replaced for a rename. It is moved (`remountFrom`), which works like
   adopting it at the new path.
2. **Referents outside the graph.** These do not follow a replace: host credential files (a new
   AppRole means a new role_id), login URLs and CLI `-path` flags naming an auth mount or role,
   policies naming a mount path, and third-party OIDC clients holding a redirect URI. Rotate or
   move them in the same PR.
3. **Unique names need `deleteFirst`.** None here: see above.

## Audited, not touched in this batch (open)

- ⚠️ `Bao.Policy`, `Bao.CloudflareRole` and `Bao.ProxmoxRole` still compare only the live object
  at the declared `name` (and `mount`). A rename plans `update` and orphans the old object, which
  is the same bug class as above. `Bao.ProxmoxRole` deliberately never answers `replace` for a
  `mint_user` change (its own comment), and that choice is sound. The rename case is separate.
- `Bao.SshRole` and `Bao.Plugin` already answer `replace` on an identity change.
