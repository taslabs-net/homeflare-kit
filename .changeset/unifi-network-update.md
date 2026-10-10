---
'@homeflare/alchemy': minor
---

Unifi.Network reconciles a declared change with one whole-object PUT (live object plus only the fields the declaration changed since the last deploy), only on a row with prior state and only when live matches that state; create/delete and every other UniFi family still refuse.
