# PBS jobs on distilled

The datastore, prune, sync and verification providers use the typed operations in
`@distilled.cloud/proxmox-backup`, generated from **proxmox-backup-server 4.2.6-1**.
`distilled-pbs.ts` supplies the existing leased read/provision credentials to the SDK's
Credentials service. The SDK owns the `PBSAPIToken` header and request serialization.

Existing props and state remain unchanged: retention windows omitted from a declaration
stay unmanaged, `remove-vanished` still defaults to false, a verification schedule may be
explicitly null, and a datastore path or backend change is refused. No automatic clearing,
new deletion flag or live job execution is introduced.

Read-only probes on 2026-09-24 found that missing configuration sections answer plain-text
HTTP 400: `no such datastore`, `no such prune`, `no such sync`, or `no such verification`.
The SDK patches those specific GET errors as `DatastoreNotFound`, `PruneJobNotFound`,
`SyncJobNotFound` and `VerifyJobNotFound`. Providers catch those tags only. Permission
errors, unrelated 400/500 responses, malformed replies and failed transports propagate.
A failed read can no longer become a speculative create or a successful deletion.

Delete first reads the declared item. A typed absent item needs no DELETE. When it exists,
the provider calls the SDK delete operation; any unclassified error during a concurrent
removal propagates. The datastore retains its bounded readback and default retain policy;
`destroy-data` is never sent.

The pinned schema declares a null result for datastore create and a UPID for delete. The
provider verifies the resulting configuration rather than inventing a create task id.

The offline lifecycle suite uses `alchemy/Test/Bun` and a strict in-memory PBS HTTP
fixture. It covers matching adoption without writes, genuine create, drift repair followed
by a no-op plan, and refused reads. Live adoption remains a separate consumer gate against
the released package; an offline fixture is not proof of the running estate.
