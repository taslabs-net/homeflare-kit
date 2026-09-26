---
'@homeflare/alchemy': minor
---

New `@homeflare/alchemy/ceph`: `Ceph.AuthEntity` (K-A4), plus the ssh mon-command transport it
runs on — built for the Talos-on-PVE ceph-csi entity, per the accepted design
(`docs/plans/2026-09-26-ceph-mon-transport.md`).

The PVE API has no `ceph auth` endpoint at all (measured against the pinned schema); this family
closes that gap over ssh + `sudo -n /usr/bin/ceph`, tried against the declared mon nodes in order,
behind a client-side argv allowlist of exact shapes — `auth get`, `auth get-or-create`, `auth
caps`, and `config get`/`set`/`rm` against a named option list that starts empty. `auth ls` and
`auth del` are refused outright: `ls` prints every key on the cluster, and a wrong delete cuts
every VM disk on it (D3, lockout safety — never auto-delete). The entity operand is bounded to the
`client.k8s-` prefix, so nothing this allowlist accepts can touch `client.admin`, a mon/osd/mgr
keyring, or the PVE storage client.

The minted key is captured once, in memory, on the create path only, and written straight to
OpenBao (`<mount>/ceph/<entity>`) — never to Alchemy props, state, argv, or a log line. Caps drift
runs `auth caps` alone and never re-mints the key. After every write the transport re-checks
`quorum_status` on a fresh connection and fails the row on a degraded answer, rather than
continuing past it. `read` and `diff` never ssh — this family's plan is props-against-state only,
and reconcile is where the only live check happens. Rows are creates through the first-create
gate: a live entity found with no prior state is refused, not adopted, even under `--adopt`.

Tested entirely offline against a fake dial — no ssh, no spawned process, ever, in this package's
own test suite. `Ceph.AuthEntity` itself is not yet consumed by a stack; that lands with the
Talos-on-PVE work this design gates.
