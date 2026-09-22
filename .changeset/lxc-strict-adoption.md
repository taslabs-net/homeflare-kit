---
'@homeflare/alchemy': minor
---

**Breaking: a `ProxmoxLxc` adoption never changes a guest.** When a guest is adopted — found by
the adoption probe with no state, or an interrupted create resumed under `--adopt` that the plan
could not prove its own — any key the declaration says otherwise now FAILS the plan, naming the
keys and never their values:

```
CT 900 on pve1: adopting it would change memory, net1. An adoption never changes a guest, so
nothing is written. …
```

Only an exact match adopts, and its deploy writes nothing. Before, such a plan said `adopted`,
only logged the keys as a warning, and `deploy --adopt --yes` wrote them. The deploy asks again
against a fresh read, so a hand edit between plan and deploy is refused rather than written back.
To change a guest, adopt it as it runs first; the change is then an ordinary `update`. The
ownership rules are unchanged: nothing is adopted without `--adopt` or `adopt(true)`, and an
interrupted create proven its own still resumes and writes. See `docs/proxmox-lxc-adopt.md`.
