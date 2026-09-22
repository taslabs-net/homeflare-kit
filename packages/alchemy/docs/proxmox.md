# Proxmox — `@homeflare/alchemy/proxmox`

PVE and PBS objects over the PVE API, each call on a short-lived token minted from an OpenBao
mount. `ProxmoxLxc` adopts a live container from its own config (a paste of `pvesh get …/config`)
or creates one from a template.

- ⛔ **It never replaces or destroys a guest by default.** A move, a smaller disk, an unprivileged
  flip or another template fails the plan. Destroy retains unless `RemovalPolicy.destroy()`.
- ⛔ **It adopts nothing without `--adopt` or `adopt(true)`**, a matching guest included
  ([ownership.md](./ownership.md)): under `destroy`, a claimed guest's disks go with it.
- ⛔ **An adoption never changes a guest.** Any key that differs from the live config fails the
  plan, named without its value ([proxmox-lxc-adopt.md](./proxmox-lxc-adopt.md)).
- ⛔ **root@pam-only keys** (`devN`, bind mounts, features beyond `nesting`) are refused at plan,
  with the `pct set` to run instead. Guide: [proxmox-lxc.md](./proxmox-lxc.md).
- ★ **One provisioning baseline for every cluster and node**: the privilege list, a helper that
  declares it, and the one-time root commands that bootstrap it
  ([provision-baseline.md](./provision-baseline.md)).
- ★ **Notifications that page**: PBS webhook, smtp and sendmail targets with write-only secrets
  (`{ fromEnv }`, never in state), PBS and PVE matchers, and a webhook body that posts an
  Alertmanager v2 alert ([pbs-notifications.md](./pbs-notifications.md)).
- ★ **Measurements in the source name a reference cluster with placeholders**: `C1`, three nodes
  `node-b`, `node-c` and `node-d` with Ceph on a Thunderbolt mesh, and documentation addresses
  (RFC 5737). The shapes and counts are measured; the names and addresses are not the real ones.
