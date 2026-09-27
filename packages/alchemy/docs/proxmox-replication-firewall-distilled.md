# Replication and firewall alias transport

The two providers call named `@distilled.cloud/proxmox/cluster` operations for
read, create, update and delete. They retain existing credential roles, lease
reuse, form guards, attributes and explicit adoption. Matching adoption writes
nothing. SDK failures propagate with their original typed errors.

## Vendor evidence

Replication was checked against local pve-manager **9.2.11**, commit
`f6997e698c7933ea8e62319e2bf1bf7262daa56a`,
`PVE/API2/ReplicationConfig.pm`:

- GET lines 105–120: exact `no such replication job '<id>'` exception.
- PUT lines 222–227: exact `no such job '<id>'` exception.
- DELETE lines 287–328: the same missing-job exception; without `force` or
  `keep`, an existing local job gets `remove_job=full`. Cleanup is asynchronous.

The source patch classifies these exact HTTP 500 messages for structured job
IDs. Other 500s, authorization failures and malformed successful reads are not
absence. PUT still sends `delete=remove_job` to revive a marked job. The provider
never adds `force` or `keep`, waits for cleanup, or widens `VM.Replicate` grants.

Firewall aliases were checked against installed **pve-firewall 6.0.5** source,
read over SSH on 2026-09-24 without reading firewall configuration:
`PVE/API2/Firewall/Aliases.pm`, SHA256
`aa4d71ea897515ca71caa8e04abd142aedf8077058649f793605f014be84db0e`.

- GET lines 203–206 and PUT line 252 raise an HTTP 400 parameter exception
  containing only `errors.name = "no such alias"` when absent.
- DELETE lines 299–327 removes the map key without checking existence. It is
  already idempotent; actual delete failures still propagate.
- PUT reconstructs the entry from name, CIDR and optional comment. Omitting a
  comment clears it; a generated `delete` field would be wrong.

Only the exact sole-field validation envelope is exposed to the SDK's
operation-specific error matcher. Wrong fields, mixed errors and unrelated
operations keep `ParameterVerificationFailed`. Alias reads require a nonempty
CIDR and a matching case-folded name. A malformed success never authorizes POST.
Case-only names remain one identity; actual renames remain create-first replace.

## Verification boundary

Offline tests run the real distilled protocol and Alchemy Plan/Apply: adoption,
second no-op, create-on-precise-absence, drift repair, retained resources, delete
failures, removal-marker revival and alias replacement order. They verify actual
form fields and that read failures stop writes. No live job or alias was created,
changed or deleted. The historical empty-cluster evidence in each resource is
not a new live acceptance claim.

SDK source changes are made in local distilled and regenerated into the interim
package. Publish the SDK before pinning a provider release to it; a local source
alias is not proof that a registry consumer can load the new error tags.
