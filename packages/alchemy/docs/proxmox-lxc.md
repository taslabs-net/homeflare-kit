# Proxmox.Lxc

A Proxmox VE container as an Alchemy resource: adopt one that runs today, or create one from a
template. It uses the same PVE client and OpenBao-minted tokens as every other
`@homeflare/alchemy/proxmox` resource. Nothing reads a stored credential.

```ts
import { adopt } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import { ProxmoxLxc } from '@homeflare/alchemy/proxmox';

export const guests = Effect.gen(function* () {
  // Adopt: paste `pvesh get /nodes/<node>/lxc/<vmid>/config --output-format json`,
  // minus `digest`, `lxc`, `lock`, `parent` and `unusedN`, and add where it lives.
  // adopt(true) (or one deploy with --adopt) says the claim is meant; without it, nothing is.
  const ct = yield* ProxmoxLxc('ct', {
    target,
    node: 'pve1',
    vmid: 900,
    hostname: 'ct-example',
    cores: 4,
    memory: 8192,
    swap: 0,
    onboot: 1,
    unprivileged: 1,
    features: 'nesting=1',
    rootfs: 'local-zfs:subvol-900-disk-0,size=40G',
    mp0: 'tank:subvol-900-disk-0,mp=/data,backup=0,size=200G',
    net0: 'name=eth0,bridge=vmbr0,hwaddr=00:00:5E:00:53:01,ip=192.0.2.10/24,type=veth',
    dev0: '/dev/dri/renderD128,uid=0,gid=44,mode=0660',
  }).pipe(adopt(true));

  // Create: a template, a new volume as `storage:GiB`, and `start` for the first boot only.
  const door = yield* ProxmoxLxc('door', {
    target,
    node: 'pve1',
    vmid: 150,
    ostemplate: 'local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst',
    rootfs: 'local-zfs:8',
    net0: 'name=eth0,bridge=vmbr0,ip=dhcp',
    features: 'nesting=1',
    onboot: 1,
    start: 1,
  });
  return { ct, door };
});
```

Provide `ProxmoxLxcProvider()` with the other providers, plus `FetchHttpClient.layer`.

## The props are PVE's keys

Every prop is the key and spelling PVE uses in `/nodes/{node}/lxc/{vmid}/config`: `mp0`, `net1`,
`dev0` and `rootfs` are property strings, and booleans may be `1`/`0` or `true`/`false`.

- ⛔ **An undeclared key is unmanaged.** It is never sent, compared or deleted, including the keys
  PVE fills in itself (`arch`, `ostype`, a NIC's `hwaddr`).
- **To remove a key, declare it as `''`.** This works for `description`, `tags`, `startup`,
  `features`, `nameserver`, `searchdomain`, `timezone` and `netN`. It is refused for a mount point.
- ⛔ `password`, `ssh-public-keys` and `env` are typed `never`, because state is stored
  unencrypted. A container created here has no root password. Use `pct enter` on its node.
- ⛔ A key the resource does not manage (`hookscript`, `lock`, `force`, …) fails the plan, and
  the create too: it is never sent.
- ⛔ The `config` attribute keeps only keys this resource manages (an allowlist, so a new PVE key
  such as `entrypoint` is not stored). Never `description` (the UI's Notes panel, where people
  paste credentials), `env`, `digest` or raw `lxc.*` values. A declared description is in props.

**Values are compared as PVE stores them, not as strings:**

- A property string is compared as a map. Key order does not matter. A default written out
  (`backup=0`, `firewall=0`, `type=veth`, `deny-write=0`, `keyctl=0`) equals the key being absent.
- An undeclared `hwaddr` is ignored, and a NIC write keeps the live MAC. A new MAC would mean a
  new DHCP lease.
- `rootfs: 'local-zfs:40'` equals `local-zfs:subvol-…,size=40G`: the storage and the size are
  compared. An existing volume is always written back with its live volume id, never with the
  new-disk spelling, which would allocate a new volume and detach the old one.
- Tags are compared as a lower-cased set, as PVE stores them by default. ⚠️ If your cluster sets
  `tag-style case-sensitive=1`, a change of case is not seen.
- `nameserver` and `searchdomain` are compared in order. `description` ignores the trailing
  newline PVE adds to it.

## What a change does

| Change                                                             | What happens                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| cores, memory, swap, hostname, onboot, tags, NIC, mount options, … | `PUT …/config`, carrying the config `digest`                        |
| A larger `rootfs` / `mpN`                                          | `PUT …/resize` after the config write, then wait for the task       |
| A new `mpN` (`storage:GiB`) or `netN`                              | `PUT …/config`                                                      |
| Nothing differs                                                    | Nothing is written, including on the first deploy after an adoption |

The `digest` makes PVE refuse the write if the config changed since the deploy read it. ⚠️ That
read is the deploy's, not the plan's: a declared key edited by hand between `plan` and `deploy`
is written back to the declaration, even after a plan that warned of nothing. (An adoption
refuses it instead.)

On a running guest, PVE may keep a change as pending until the next restart. A read returns the
pending value, so the plan still converges.

## What is refused, and why

The plan fails with a sentence, and nothing is written. Nothing here plans a replace, because a
replace of a guest deletes a running machine and its disks.

| Change                                                                                            | Why                                                                    |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `vmid`                                                                                            | A new vmid is a different guest.                                       |
| `node`, while the guest is on another node                                                        | This resource never migrates.                                          |
| `ostemplate`                                                                                      | The template is used up at create. Another template means a new guest. |
| `unprivileged`                                                                                    | PVE: "unable to modify read-only option"                               |
| A smaller `rootfs` / `mpN`                                                                        | PVE: "unable to shrink disk size"                                      |
| Another storage                                                                                   | Use `pct move-volume`, which copies. It is not a config edit.          |
| Another volume, or `mpN: ''`                                                                      | The live volume would be detached to `unusedN`.                        |
| A create naming an existing volume id (not `storage:GiB`)                                         | PVE would unpack the template onto that volume.                        |
| `devN`, a bind or device mount, a feature other than `nesting`, any feature on a privileged guest | Only root@pam can write these (see below)                              |

A vmid that belongs to another node, or to a QEMU VM, fails the plan and says where it is. It
does not plan a create. After HA or `pct migrate` has moved a guest, set `node` to where it is
now: the plan is an update that writes nothing and records the new node.

### root@pam only: device passthrough, bind mounts, most features

PVE's `check_ct_modify_config_perm` (pve-container 6.1.14) lets only `root@pam` write these. An
API token's user is always `user@realm!token`, never `root@pam`, so no minted token can write them.

For these, the plan refuses and prints the exact `pct set <vmid> --<key> '<value>'` to run on the
node. After you run it, declare the value, and the next plan compares it like any other key. A
guest that needs `/dev/net/tun` (a Mesh door) or `/dev/dri` is created in two steps:

1. Declare the guest without the device, and deploy.
2. Run the `pct set` on the node, then add `dev0` to the declaration.

`nesting` on an unprivileged guest is allowed. It needs `VM.Allocate`, which the
[provisioning baseline](./provision-baseline.md)'s role has.

### Gaps

- **Raw `lxc.*` lines** (`lxc.prlimit.memlock`, `lxc.cgroup2.devices.allow`, `lxc.mount.entry`)
  can be read through the API but not set. They are edited in `/etc/pve/lxc/<vmid>.conf` on the
  node. The attribute `rawKeys` lists their names only. Values are never stored, because
  `lxc.environment` can hold anything.
- **Power state is not declared.** `start: 1` boots the guest once, after its create. After
  that, `onboot` is the setting, and starting or stopping is an operator's job.
- **Pool membership, HA, firewall rules, snapshots, replication** are not declared here. Use their
  own resources, or manage them by hand.

### ⛔ The guest's INSIDE is not reachable, and no kit Resource can change that

This resource declares a guest's PVE-level config: the keys in
`/nodes/{node}/lxc/{vmid}/config`. It cannot install a package, write a file into the guest, or
define a service — and **neither can anything else built on PVE's API**, because PVE does not
expose it for containers:

| Reach inside  | QEMU VM                               | LXC container |
| ------------- | ------------------------------------- | ------------- |
| Run a command | `POST …/qemu/{vmid}/agent/exec`       | —             |
| Write a file  | `POST …/qemu/{vmid}/agent/file-write` | —             |
| Read a file   | `GET …/qemu/{vmid}/agent/file-read`   | —             |
| cloud-init    | `…/qemu/{vmid}/cloudinit`             | —             |

Measured across the whole `/nodes/{node}/lxc/{vmid}/…` endpoint set in
`src/proxmox/generated/pve.ts`, and pinned by `src/proxmox/lxc-interior.test.ts` so that it fails
the day PVE adds one. The only reach inside is `termproxy` / `vncwebsocket`, an interactive
console for a person — not something a resource can diff.

⚠️ **Sibling families are not at parity.** QEMU and LXC sit under the same `/nodes/{node}/…` tree
and have completely different reach. Do not infer one from the other, here or anywhere else.

So a generic, vendor-API-based Resource for a container's interior **cannot be written**: there is
nothing to wrap. What is left, in the order that keeps a change declarative:

1. **Bake it into the template.** Publish a rootfs tarball to `vztmpl` and name it as
   `ostemplate`. ⚠️ `ostemplate` is create-only and never read back, so the interior gets no drift
   detection, and changing it REPLACES the guest. Right for something stateless and immutable; a
   decision for anything else.
2. **A first-boot artifact** the image already carries, which configures itself from what it can
   see locally.
3. **A recorded one-time human step**, named as undeclared.

⛔ **An exec-over-SSH resource is not option zero.** It is reachable, but not through the vendor,
so it needs a credential and a network path _to the guest_ — and if the guest is what provides
credentials, naming or network reach to others, that inverts the bootstrap: the new system's first
boot then depends on its own output, and it fails when the dependency is down. The
`@homeflare/alchemy/launchd` `HostRunner` seam is where such a runner would plug in, and the kit
ships only `localRunner()` and `sudoRunner()` on purpose.

## Adopting

⛔ **No live guest is adopted without `adopt(true)` or `--adopt`, and an adoption never changes
a guest.** It is taken over exactly as it runs, or the plan fails naming each key that differs.
What the plan says, what counts as an adoption, and the leases each step uses:
[proxmox-lxc-adopt.md](./proxmox-lxc-adopt.md).

## Removing

`defaultRemovalPolicy: 'retain'`. If you drop the declaration, the state row is dropped and the
guest keeps running. Only `.pipe(RemovalPolicy.destroy())` reaches the delete. That delete never
forces, purges or stops the guest first: PVE refuses to delete a running or protected guest, and
that refusal is kept. It also deletes only a guest that still matches its last declaration: a
vmid is reusable, so one that differs may be somebody else's, and the delete is refused.
