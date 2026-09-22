---
'@homeflare/alchemy': minor
---

Export `ProxmoxCephDaemon`, `ProxmoxCephFs` and `ProxmoxCephOsd` from `@homeflare/alchemy/proxmox`, so a stack can adopt a live cluster's Ceph monitors, managers, metadata servers, CephFS and OSDs. Each is adopt-only by shape: none has an update path, the daemon and filesystem compare nothing so they can never plan a replace, and an OSD is created only when `dev` is declared. All three retain on destroy, so removing a declaration drops its state row and never sends a DELETE. `ProxmoxCephFlag` stays Provider-only on purpose: a declared flag reasserts a maintenance toggle such as `noout` on every deploy.
