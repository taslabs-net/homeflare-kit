---
'@homeflare/alchemy': patch
---

`client.ts`'s `executeOnCluster` and `distilled-pve.ts`'s `runPveWith`
(`members.ts`, shared by both) now bound a single cluster-member attempt with
a new `MEMBER_TIMEOUT` (20 seconds). Previously nothing did: a PVE member
that accepted the TCP connection but never answered hung the whole call
forever, because the cluster-failover loop never got a failure to classify
and so never reached a healthy member — this affected every PVE resource,
migrated or not, since both codepaths funnel through `executeOnCluster`. A
bounded timeout now fails a read over to the next member (no side effect to
duplicate) and fails a write outright without resending it, matching the
existing rule that a post-connect failure is never pre-send. Found on review
of `Proxmox.Acl`'s migration (PR 209); fixed once, shared by every PVE
family.
