---
'@homeflare/alchemy': patch
---

Follow-up minors for the `talos-openbao` cluster adapter: a failed write of a credential temp
file (disk full) now removes the already-created 0600 file instead of leaving it behind; the
`talosctl version --client` probe has a 3 s deadline and fails closed with `TalosBinaryRefused`
instead of hanging; the `TalosClusterIdentityTimeout` text and the docs now say what the code does
(a 5 s uid read inside the 10 s connect deadline).
