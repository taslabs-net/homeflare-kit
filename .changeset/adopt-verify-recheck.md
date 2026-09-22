---
'@homeflare/alchemy': patch
---

**Fix: `hf-adopt-verify` no longer passes a drifted adoption whose provider's `diff` never looks at
the live object.** Alchemy gives an adopted row's `diff` the declaration as its recorded props, so
a diff that compares recorded props with the declaration says `noop` whatever the cloud holds.
Alchemy's own `Cloudflare.R2Bucket` diff works that way. The verifier printed `ok` and exited `0`
while listing the drift under `changed`, and the deploy then wrote it. Now an adopted `noop` with
something under `changed` gets its `diff` run a second time, with the live values of those fields
passed as the recorded props (still read-only, and write paths are still refused). A second
`noop` passes with a note that the family does not manage those fields. Any other answer fails
the row. The answer appears as `recheck` in the JSON report. No kit PVE/PBS family is affected:
each one's `diff` re-reads the cluster.

**Fix: the default report no longer hides a `create` when a rename hands its old id to a new
resource.** A row now counts as stateful only when it plans from the state row it reads, rather
than any row that happens to sit at its FQN.
