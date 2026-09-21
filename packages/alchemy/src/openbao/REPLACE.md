# Replace semantics: the `Bao.*` providers

Audited 2026-09-21, against `alchemy@2.0.0-beta.79` and OpenBao v2.6.2 source, in two batches.
Every kit provider must answer `replace` correctly (vault consolidation plan, "Replace freely").

★ **Measured, not only read.** `fake-stack.ts` runs beta.79's own `Plan.make` and `apply` over an
in-memory state store against the fake engines in `fake-engines.ts` and `fake-engines-roles.ts`.
`policy-rename.test.ts`, `role-rename.test.ts`, `rename-occupied.test.ts`,
`rename-families.test.ts`, `rename-identity.test.ts` and `rename-adoption.test.ts` deploy, rename,
and deploy again, then check the plan and every call that reached the fake.

## What Alchemy does with each answer

- **`update`**: `reconcile` runs against the same resource. Only safe when the object's identity
  (its path) is unchanged.
- **`replace`**: create-first by default. The new generation is created, dependents are updated in
  the same graph, then the old generation is deleted (`Apply.ts`, delete-first comment near :1180).
  ★ That delete gets the **old** generation's attributes (`output: old.attr`), so a provider that
  deletes by `output` deletes the old path. Measured: `PUT` of the new path, then `DELETE` of the
  old one.
- **No answer** (`undefined`, which every diff returns while `news` holds a pending Output): the
  engine plans `update` if any prop changed (`Plan.ts`, `havePropsChanged`). ⚠️ That is the bug
  class below whenever the identity changed too.
- **`deleteFirst: true`**: tears the old one down first. It is only for identities that cannot
  coexist, such as a unique physical name. No `Bao.*` provider uses it. A rename is a new API
  path, which never collides with the old one. ⚠️ A mount or auth method whose `type` changes
  keeps its path, so the two generations DO collide. It deliberately stays create-first, and the
  create fails (see the table).
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

🔴 Reproduced through the engine on 2026-09-21 for `Bao.Policy` under `RemovalPolicy.destroy()`:
deploy `app-old`, redeclare it as `app-new`, deploy. The plan said `update`, and both policies
stayed live. `destroy` could not help, because nothing recorded the old one.

## Answers, by resource

⛔ Every family below except `Bao.Mount` and `Bao.AuthMethod` judges its identity **before**
`isResolved(news)`, and **fails the plan** on a move onto an object that already exists
(`rename-identity.ts`, below). Names compare as the server keys them: exact, except where a row
says folded.

| Resource                  | Identity change           | Answer now                                                                                                                                                            | Other changes                                                                               |
| ------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Bao.Mount`               | `path`                    | ⛔ **fails the plan**, unless `remountFrom` names the old path. Then it is an in-place `update` that moves the mount with `sys/remount`.                              | `type` → `replace` that **fails at apply** (below). Description and TTLs → `update` (tune). |
| `Bao.AuthMethod`          | `path`                    | Same as `Bao.Mount` (`auth/` prefix). The accessor survives the move.                                                                                                 | `type` → `replace` that **fails at apply** (below)                                          |
| `Bao.AuthRole`            | `name` (folded)           | `replace`. Before 2026-09-21 it was `update`, and the old role was orphaned. Its delete clears the secret_ids; issued tokens run to their TTL (below).                | `update`                                                                                    |
| `Bao.PkiRole`             | `mount`, `name`           | `replace`. Before, only a `mount` change was caught; a `name` change orphaned the old role.                                                                           | `update` (full-replace write)                                                               |
| `Bao.JwtRole`             | `mount`, `name` (folded)  | `replace`. The name is folded: the server reads it lowercased (TypeLowerCaseString).                                                                                  | `update` (merge write; every managed field is sent)                                         |
| `Bao.KubernetesRole`      | `mount`, `name` (folded)  | `replace`. The name is folded, as the server stores it.                                                                                                               | `update`                                                                                    |
| `Bao.JwtAuthConfig`       | `mount`                   | `replace`. The old delete is a no-op because there is no delete endpoint. A move onto a mount with a config fails the plan too: it would rewrite that mount's logins. | `update` (full-replace write)                                                               |
| `Bao.MfaTotpMethod`       | `name`                    | ⛔ **fails the plan**: a new id would strand every enrolled secret. Reconcile refuses it too, when the name was an Output.                                            | `update` (the upsert keeps the id)                                                          |
| `Bao.MfaLoginEnforcement` | `name`                    | `replace`. Its delete is **refused** (openbao#4030)                                                                                                                   | `update`                                                                                    |
| `Bao.SshRole`             | `mount`, `name`           | `replace`                                                                                                                                                             | `update` (full-replace write)                                                               |
| `Bao.Plugin`              | `type`, `name`, `version` | `replace`: a version bump is a new catalog entry, and `retain` keeps the old version registered.                                                                      | `update` (full-replace register)                                                            |
| `Bao.Policy`              | `name`                    | `replace` (batch 3A). Compared as OpenBao keys it, trimmed and lowercased, so `Admin` → `admin` is the same policy: `noop`.                                           | `update` (fragments digest)                                                                 |
| `Bao.CloudflareRole`      | `mount`, `name`           | `replace` (batch 3A). Exact; a trailing `/` on the mount is the same path.                                                                                            | `update`                                                                                    |
| `Bao.ProxmoxRole`         | `mount`, `name`           | `replace` (batch 3A). ⛔ **Fails the plan** if the rename also changes `mintUser`, unless `allowMintUserChange` names the old one.                                    | `update`. A `mintUser` change at the same path is refused at apply, never replaced.         |

`hostAppRoles` makes no resources, but its names are identities: renaming a host or a class
renames the role. With the logical id taken from the role name, as the README does, the old id
leaves the stack: that is an orphan delete, not a `replace`. With a stable logical id,
`Bao.AuthRole` plans a `replace`. Under the default `retain`, both leave the old role live. A
host may sit in several classes: it gets one role per class, and only the same host twice in one
class is refused.

## When the new identity is not known at plan

- **Only another prop is pending** (say `fragments` is an Output of an upstream that is also
  changing). Every family judges the identity props before `isResolved(news)`
  (`rename-identity.ts`), so the rename still plans `replace`. Measured for all twelve. Before
  2026-09-21 the nine batch-2 families planned `update` here and orphaned the old object.
- **The identity itself is pending.** Then the diff defers: it never answers `replace` on an
  unknown identity, because under `destroy` a replace onto the same path deletes what it just
  wrote. The engine plans `update`, and reconcile, seeing the old attributes name another
  object, **refuses before any write**. The row is left `updating`, with the new props and the
  old attributes. The next deploy sees both names and plans `replace`. Measured for all twelve.
  `Bao.MfaTotpMethod` refuses there with its rename refusal, and its next plan fails the same way.
- `Bao.ProxmoxRole` defers the same way while `mintUser` or `allowMintUserChange` is pending on a
  rename, because the re-scope guard cannot be checked. Measured for `allowMintUserChange`.

## A move onto an object that already exists fails the plan

⛔ Every family in the table reads the new path at plan (`judgeMove`, `rename.ts`) and refuses the
move if anything is there. 🔴 Measured before the guard: two policies that swapped names under
`RemovalPolicy.destroy()` both planned `replace`. Each new generation wrote over the other's live
policy, and each old generation's delete then removed the name the other had just written. The
deploy was green, and both policies were gone, every grant revoked. The same swap deleted both
objects for `Bao.AuthRole`, `Bao.PkiRole`, `Bao.JwtRole`, `Bao.KubernetesRole`, `Bao.SshRole` and
`Bao.Plugin`. `Bao.JwtAuthConfig` (no delete) and `Bao.MfaLoginEnforcement` (delete refused) lost
nothing, but each new generation silently rewrote the other's live object. Measured the same way:

- a shift (`a → b` while `b → c`) deleted `b`, and a move onto the name of a resource leaving the
  stack deleted the name it moved onto;
- reverting a move whose new generation failed. The old generation still holds the name, and its
  delete runs after the revert rewrites it. So the diff compares against the props of an
  unfinished create or replacement when there are no attributes yet. Declaring the new name again
  finishes the move instead.

⚠️ The diff cannot see the removal policy, so this refuses under `retain` too, where a swap would
have been harmless. So would a move back onto a retained old generation. Move in two deploys
through a name nothing holds, or remove the target by hand first. For `Bao.Plugin` that includes a
version bump onto a version already registered by hand. A change of case the server folds (policy,
AppRole, JWT and Kubernetes role names), or a trailing `/` on a mount, is the same object, so it is
not a move and is never refused (`rename-identity.test.ts`).

## What `retain` means for batch 3A and AppRole

Under the default `retain` the old generation is kept, and the apply says so ("Replaced resource
retained."). It is live and unmanaged from then on:

- **`Bao.Policy`**: the old policy keeps every grant, for every token, role and group that still
  names it. Under `destroy` they lose those grants at the delete. ⚠️ Only a role that takes the
  policy's `name` Output follows the rename in the same graph. A role that names the policy as a
  literal string (`tokenPolicies: ['deploy']`) keeps the old name, so change it in the same PR.
- **`Bao.CloudflareRole`**: the old role still mints, for any token whose ACL reaches its
  `creds/<name>`. Under `destroy` every consumer still minting from the old path fails. Tokens
  already minted are leases and live to their own expiry either way.
- **`Bao.ProxmoxRole`**: the same, and the old role keeps minting under its old `mint_user`. The
  plugin's delete leaves outstanding leases revocable (its own
  `TestDeletingARoleLeavesItsOutstandingLeasesRevocable`).
- **`Bao.AuthRole`**: the old role keeps admitting its secret_ids. Under `destroy` the delete
  removes every secret_id and the role_id, so no new login succeeds, but it revokes no token:
  tokens already issued live to their TTL and only fail to renew (openbao v2.6.2 approle
  `pathRoleDelete`, path_role.go:1858-1902; `pathLoginRenew`, path_login.go:414-438). Revoke by
  accessor to contain one.

★ A stack that puts `mount` and `name` in the logical id, as homeflare-openbao's
`declareCloudflareRoles` does, never reaches the `replace`: the old id leaves the stack as an
orphan delete, which `retain` also keeps live.

## A new declaration of a live name: the swap the guard cannot see

⚠️ A NEW logical id whose name already exists takes that object over and rewrites it: these
families' `read` never answers `Unowned`, so Alchemy silently adopts it. Nothing moved, so
`judgeMove` never runs. 🔴 Measured (`rename-adoption.test.ts`): under `destroy` the old owner's
delete then runs after the adoption wrote, and removes the object the new id now claims, in a
green deploy. It happened when a logical id changed with the name kept, to each of the nine
batch-2 families whose delete runs (a TOTP method and its enrolments included), and when a new
`Bao.AuthRole` took a name another one moved off in the same deploy. Change a logical id with
Alchemy's `renamedFrom('<old id>')`, which migrates the state row and plans an `update`. Take a
freed name in the deploy after the move.

## Why the moves fail instead of replacing

- **Mount and auth path.** A `replace` would create an empty mount. Deleting the old one would
  destroy every secret, and with the default `retain` the data would be stranded. `sys/remount`
  is the only move that keeps the data: the mount keeps its UUID, and storage lives under the
  UUID (`vault/mount.go:630-735`). ⛔ It **revokes every lease** under the old path
  (`RevokePrefix`, :684), and it rewrites no policy that names the old path.
- **TOTP method name.** Every enrolled secret is keyed by the method id
  (`entity.MFASecrets[id]`). The safe rename adds a second method, lists both on the enforcement
  (any one passing is enough), enrols everyone, then drops the old method.

## Why a type change fails instead of replacing

The plan says `replace`, but the new generation reads the same path, finds the old type there,
and its reconcile dies with "type is immutable" before any write. So the deploy fails, and
nothing is disabled under either removal policy. Change a type by hand. ⛔ `deleteFirst` would
make it succeed, but under `destroy` it disables the mount first, and a mistyped `type` would
take every secret with it. (Corrected 2026-09-21: the first audit listed this as a clean
`replace`.)

## The plan's three exceptions, mapped

1. **`retain` resources orphan the old generation on a replace.** That applies to all of the
   above. A mount is never replaced for a rename. It is moved (`remountFrom`), which works like
   adopting it at the new path.
2. **Referents outside the graph.** These do not follow a replace: host credential files (a new
   AppRole means a new role_id), login URLs and CLI `-path` flags naming an auth mount or role,
   policies naming a mount path, and third-party OIDC clients holding a redirect URI. Rotate or
   move them in the same PR.
3. **Unique names need `deleteFirst`.** Only a mount's `type` change keeps its unique path, and
   it fails on purpose instead (above).

## Closed

- ✅ **Nine families checked the identity after `isResolved(news)`** and never read the target
  (closed 2026-09-21 by `rename-identity.ts`, measured in `rename-families.test.ts`).
  `Bao.Mount` and `Bao.AuthMethod` never needed it: their reconcile re-plans the move from the
  stated path.
