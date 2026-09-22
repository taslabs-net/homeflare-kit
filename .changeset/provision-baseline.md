---
'@homeflare/alchemy': minor
---

**New: the provisioning baseline, one description for every cluster and node.**
`@homeflare/alchemy/proxmox` now exports:

- `PROVISION_PRIVILEGES`: the provision role's 27 privileges as one sorted, frozen constant. It is
  the union of what every family's reconcile needs, including what the lane needs to manage the
  baseline itself.
- `PROVISION_DEFAULTS` and `provisionBaseline(names)`: generic names (role `HfProvisioner`, users
  `hf-provision@pve` and `hf-read@pve`, group `hf-mint`, read role `PVEAuditor`), overridable per
  site. Names that are not PVE-shaped or would need shell quoting are refused.
- `declareProvisionBaseline(id, target, names?, { adopt? })`: declares the role, the mint group,
  one user per lane (its group membership included) and the grant for each lane on `/`. Every
  resource retains, and `adopt` is piped only when asked.
- `provisionBootstrap(names?)`: a pure generator of the one-time root commands for a new cluster
  or node, as a POSIX `sh` script. It checks each object before changing it, so it is idempotent,
  and it never creates a token or sets a password.

The provision lane cannot create itself, so root bootstraps it once, then the stack adopts it and
keeps it. After the bootstrap, the declaration is a clean adoption that writes nothing. See
`docs/provision-baseline.md`.
