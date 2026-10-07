---
'@homeflare/alchemy': patch
---

Follow-up minors for the `talos-openbao` cluster adapter: a failed write or a failed close of a
credential temp file (disk full, EIO/EDQUOT at close) now removes the already-created 0600 file
instead of leaving it behind; the `talosctl version --client` probe has a 10 s deadline
(overridable with `TalosRunOptions.versionProbeTimeout`) and fails closed with `TalosBinaryRefused`
instead of hanging, killing a hung child with its process group; the `TalosClusterIdentityTimeout`
text and the docs now say what the code does (a 5 s uid read inside the 10 s connect deadline).
