# Provisioning baseline — every cluster, every node

Every `@homeflare/alchemy/proxmox` resource runs as a short-lived PVE token that OpenBao mints for
a **provision user**. That user, and the access it holds, is the baseline a cluster needs before a
stack can manage anything on it. This subpath ships it as one description with two readers:

| export                      | what it is                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `PROVISION_PRIVILEGES`      | the provision role's privileges: 27, sorted, the exact set                                          |
| `PROVISION_DEFAULTS`        | the generic names in the last table, each overridable                                               |
| `ProvisionNames`            | those names, plus `groupComment` / `provisionComment` / `readComment`, each defaulting to `comment` |
| `provisionBaseline(names)`  | the resolved baseline both readers use; refuses names that are not PVE-shaped                       |
| `declareProvisionBaseline`  | the baseline as `Proxmox.Role`, `Proxmox.Group`, `Proxmox.User` and `Proxmox.Acl` resources         |
| `provisionBootstrap(names)` | the one-time root commands for a new cluster or node, as a `sh` script                              |

## The chicken and the egg

⛔ **The provision lane cannot create itself.** A plan needs a minted token, and a mint needs the
provision user to exist, be in the mint group, and hold the role on `/`. On a new cluster none of
that exists, so no plan can run, including the plan that would create it.

So root makes it once, and the stack takes it over from there:

1. **Bootstrap, as root, once per cluster.** Generate the script and run it on any one node:

   ```sh
   bun -e "import { provisionBootstrap } from '@homeflare/alchemy/proxmox';
           process.stdout.write(provisionBootstrap())" | ssh root@node-a sh
   ```

   Read it first: it is plain text with no secret in it. It checks each object and changes only
   what differs, naming each step (`role HfProvisioner: adding`, `user hf-read@pve: ok`). It
   never creates a token and never sets a password.

2. **Point OpenBao at the users.** The proxmox secrets engine mints for them through a
   `Bao.ProxmoxRole` per lane (`mintUser: PROVISION_DEFAULTS.provisionUser`, and the read user).
   The engine's own credential, a user allowed to manage tokens for members of the mint group, is
   set up with the engine. It is not part of this baseline.

3. **Declare the baseline in the stack, and adopt it once:**

   ```ts
   import * as Effect from 'effect/Effect';
   import { declareProvisionBaseline } from '@homeflare/alchemy/proxmox';

   export const access = Effect.gen(function* () {
     return yield* declareProvisionBaseline('pve', target);
   });
   ```

   The first deploy finds everything live with no state. Run it with `--adopt`, or pass
   `{ adopt: true }`. Because the script made exactly what the declaration holds, the plan is a
   clean adoption and the deploy writes nothing. From then on, a hand edit (a privilege added in
   the UI, a user dropped from the group) shows up as a diff on the next plan.

## A cluster that already exists

⚠️ **The common case is not a blank cluster.** One that already has a mint group and a
read user — with their own live comments, which another stack may already declare at
those values — must not have them rewritten by a bootstrap that only came to add a
provision lane. A comment per object says that, and each one defaults to `comment`:

```ts
const names = {
  role: 'LXCProvisioner',
  groupComment: '', // live: no comment at all
  readComment: 'mint target: read (ops)', // live: its own wording
  provisionComment: 'mint target: provision (ops)', // the one new object
};
```

The script then prints `group hf-mint: ok` and `user hf-read@pve: ok` and writes only
the role, the new user and its grant. ⛔ With one shared comment it would modify all
three, and the next deploy of the stack that declares the other two would write them
back — a loop that looks like drift and is not.

★ `readComment` goes with its lane: a `null` `readUser` drops the user, so the field is
neither used nor checked.

## Every cluster, every node

- **A new cluster:** run the bootstrap on one node, then deploy.
- **A node joining a cluster:** nothing to do. Users, groups, roles and ACLs live in
  `/etc/pve/user.cfg`, which the cluster shares. Running the script there prints `ok` for every
  step and writes nothing.
- **A standalone node:** it is its own cluster. Bootstrap it.

## Your own names

Every name has a generic default, and a site passes its own to both readers:

```ts
const names = { role: 'Provisioner', mintGroup: 'mint', readUser: null };
provisionBootstrap(names); // the script
declareProvisionBaseline('pve', target, names); // the resources
```

- `readUser: null` gives a baseline with no read lane.
- `comment` is every object's comment; `groupComment`, `provisionComment` and
  `readComment` override it one object at a time.
- `readRole` must already exist (`PVEAuditor` is built in). The script stops before any write if
  it does not.
- A name that is not PVE-shaped, or that would need quoting in a shell, is refused by both
  readers before either one runs.

## What the baseline holds

| object                           | detail                                                     |
| -------------------------------- | ---------------------------------------------------------- |
| role `HfProvisioner`             | exactly `PROVISION_PRIVILEGES`, nothing more, nothing less |
| group `hf-mint`                  | the fence: OpenBao may mint only for its members           |
| user `hf-provision@pve`          | in `hf-mint` only, enabled, no password, no expiry         |
| user `hf-read@pve`               | the same, for the read lane                                |
| `/`, `hf-provision@pve`, role    | `HfProvisioner`, propagated                                |
| `/`, `hf-read@pve`, `PVEAuditor` | propagated                                                 |

★ **One privilege list for every family.** It is the union of what each resource's reconcile
needs. That includes managing this baseline itself (`Sys.Modify`, `Realm.AllocateUser`,
`User.Modify`, `Group.Allocate`, `Permissions.Modify`), so declaring it can never narrow the lane
out of its own repair. It does not include writes PVE keeps for `root@pam` (device passthrough,
bind mounts). Those are refused at plan with the command to run instead.

⚠️ **The role is the exact set.** Both the script and `Proxmox.Role` replace the privileges, never
add to them. A privilege added by hand is removed on the next run or deploy. If you need more,
declare your own role and grant.

⛔ **Everything retains.** Dropping `declareProvisionBaseline` from a stack drops its state and
leaves the role, users, group and grants in place. Deleting the provision user would revoke every
lease at once, including the one the next plan needs.

⚠️ **Adoption today.** `Proxmox.Role`, `Group`, `User` and `Acl` still read a live object with no
state as their own (the `pveHandlers` limit in [ownership.md](./ownership.md)). The `adopt`
option says what the stack means, so it keeps holding when those families follow the rule.
