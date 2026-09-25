# LXC through distilled

`Proxmox.Lxc` uses the generated config GET/PUT, cluster resource index, container
POST/DELETE, resize PUT and task-status GET. Form guards, ownership checks, strict
adoption, no-shrink rules, digests, state filtering and default retain are preserved.
`NetworkApply` retains its separate helper; this slice does not change network reloads.

## Absence and permissions

The SDK's GET-only `LxcConfigNotFound` matches the exact vendor missing-config
exception. Permission errors, arbitrary HTTP500 responses and malformed successful
config reads remain failures. A config requires the vendor's digest field.

A missing config on one node does not prove its cluster-wide vmid is free. The
provider retains the same read credential for the subsequent `type=vm` cluster
index. The config handler requires `VM.Audit` on `/vms/{vmid}` before loading the
config. The cluster index filters by that same permission, so this credential can
observe that vmid, including a QEMU guest or a container moved to another node.
Those collisions refuse creation. A malformed index cannot establish absence.

## Writes and tasks

Every task-starting write receives a fresh provision credential and polls with
that exact credential. Config PUT keeps the digest and precedes disk growth.
Creation waits up to the existing 180 one-second polls; resize/delete use 60.
A failed or malformed poll is an uncertain task outcome with the UPID and task-log
guidance. It never authorizes a second write. A completed task must say exactly `OK`.

The SDK percent-encodes UPID path labels. Installed PVE HTTP server source decodes
the request path before routing; this reaches the same task as the literal UPID.
The generated SDK currently names indexed config placeholders `net_n_`, `mp_n_`,
`dev_n_` and `unused_n_`. Its core transport explicitly passes unknown body keys
through, so vendor `net0`/`mp0` form keys are preserved and tested. Improving the
generated dynamic-key type surface remains a concrete SDK generator follow-up.

## Evidence and scope

The pinned PVE9.2.11 schema cache matches the repository manifest SHA256
`9def8f13611184ee1c7d0399713130dfc4a065701d0d91a69b9c03df929344e9`.
Local pinned pve-manager source at `f6997e698c7933ea8e62319e2bf1bf7262daa56a`,
`PVE/API2/Cluster.pm:588`, supplies the per-vmid list permission filter.

Installed source was read without modifying PVE on 2026-09-24:

| Package                       | File and relevant lines    | SHA256                                                             |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------ |
| pve-container6.1.13           | API2/LXC/Config.pm:25–100  | `65ed7408b4bab8e0ffc7235019b2b0486b1cc039af4985754175b6543ffa0984` |
| pve-container6.1.13           | LXC/Config.pm:60–65        | `5d6614024d6570114820d811dc0f4c403a5b9e4ed404d66d89d0fed9e9ffdb2c` |
| libpve-guest-common-perl6.0.5 | AbstractConfig.pm:51–62    | `70432cce604f3bc7ff525c2c20028a97173394d5aa2b585c36b50d0761871494` |
| libpve-http-server-perl6.0.5  | APIServer/AnyEvent.pm:1542 | `ff86c8fed9af157f909578e7ecf3e4144032cccf5d72af73e27243860de3013a` |

Offline engine tests prove matching adoption, create-to-noop, ownership, retention,
digest handling, collision refusal and no shrink. SDK boundary tests pin indexed
fields, credential continuity and bounded task uncertainty. No live LXC write or
deploy is part of this migration. The opt-in vault-door consumer still needs its
published dependency, declaration review and live plan before any creation.
