---
'@homeflare/alchemy': patch
---

The ownership and `ProxmoxLxc` guides now say how to read an adoption's plan before it writes. `alchemy plan` has no `--adopt` flag in alchemy 2.0.0-beta.79, so without adoption on it stops at "Cannot adopt" before any resource can warn what taking the object over would write. Run `alchemy deploy --adopt --dry-run` instead, or declare `.pipe(adopt(true))` and run `alchemy plan`. The LXC guide also warns that a drift warning does not stop the deploy: `deploy --adopt --yes` writes a `net0` declared without the live `tag=` without it, and the guest leaves its VLAN.
