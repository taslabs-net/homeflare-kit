# Proxmox.Lxc — adopting a live guest

The adoption half of [proxmox-lxc.md](./proxmox-lxc.md). Two rules, both decided 2026-09-21:

1. ⛔ **No live guest is adopted without `adopt(true)` or `--adopt`, not even one that matches the
   declaration** — the kit-wide rule in [ownership.md](./ownership.md). Without either, the plan
   fails with "Cannot adopt" and nothing is written. Matching is not proof the guest is yours: a
   pasted config or a mistyped vmid reads the same, and once state claims a guest,
   `RemovalPolicy.destroy()` deletes it and its volumes. `.pipe(adopt(false))` stays refused
   under `--adopt`.
2. ⛔ **An adoption never changes a guest.** It is taken over exactly as it runs, or not at all.
   With adoption on, a declaration that differs from the live config in any key fails the plan:

```
CT 100 on pve1: adopting it would change memory, net1. An adoption never changes a guest, so
nothing is written. Declare what is live for these keys (the plan names keys, never values) and
plan again; change them after the adoption, as an update.
```

- **Keys are named, values never.** A live config can carry anything (`description` is where
  people paste credentials), and plan output lands in CI logs.
- **The fix is the declaration.** Copy the live value for each named key and plan again. A plan
  that says `adopted` and fails nothing is the zero-change check: the deploy writes nothing (two
  GETs), and the next plan is `noop`.
- **To change the guest, adopt it first.** Once state holds it, a changed declaration is an
  ordinary `update`, and its plan warns with each key the deploy writes:

```
Proxmox.Lxc pve1/100: live config differs from the declaration in memory -- a deploy writes these.
```

- **The deploy asks again.** A key edited by hand between the plan and the deploy is refused at
  apply, with nothing written. The adoption's state row stays, and every plan refuses the same way
  until the declaration says what is live. Then it adopts with no write.
- **It comes before the other refusals.** A root@pam-only key, a smaller disk or an unprivileged
  flip would print a declared value and a `pct set` to run. For an adoption the fix runs the other
  way, so the adoption refusal is the one you see.

★ **Why it is strict.** Alchemy 2.0.0-beta.79 plans a cold adoption as `adopted` whatever it would
write, and prints no property diff for it. Until this rule, `diff` only logged the keys, and
`deploy --adopt --yes` then wrote them: a `net0` pasted without the live `tag=` took the guest off
its VLAN on the deploy that was meant to change nothing.

⚠️ **`alchemy plan` has no `--adopt` flag** (2.0.0-beta.79: only `deploy` declares it). Without
adoption on, the plan stops at "Cannot adopt" before the adoption check runs. To read the
adoption's plan, run `alchemy deploy --adopt --dry-run`, or declare `.pipe(adopt(true))` and run
`alchemy plan`.

## What counts as an adoption

State says, at plan and at apply alike (`src/ownership/adopting.ts`):

| the guest reached state…                                                        | adoption? |
| ------------------------------------------------------------------------------- | --------- |
| through the adoption probe: no state for it, found live                         | yes       |
| on the deploy after that probe, until the adoption commits                      | yes       |
| through an interrupted create the plan could not prove its own, under `--adopt` | yes       |
| through an interrupted create whose guest still matches what it wrote           | no        |
| through this resource's own create, or an adoption that has committed           | no        |

An interrupted create proven its own is not an adoption. If its declaration changed meanwhile, the
deploy writes the change.

## Creates that find a guest

A deploy that planned a **create** never takes over a guest it then finds at that vmid (the plan
skips its adoption read while a prop is an unresolved Output, and a guest can appear after the
plan). Without adoption on, the deploy fails and forgets its `creating` row, so the next plan asks.
With it on, a matching guest is recorded with no write; any other fails until a plan can show it.

A create interrupted after its POST resumes on the next deploy **without** `--adopt` when the guest
still matches what it declared. If someone changed it meanwhile, the plan says "Cannot resume
creating". `--adopt` then adopts it as it now runs: declare what is live first.

A guest the cluster no longer lists at all, with state still held, plans `update` and warns that
the deploy **creates it again** from `ostemplate`, with new volumes. The plan fails instead when
there is no `ostemplate`, or when `rootfs`/`mpN` are declared by live volume id (as a paste is):
a create never reuses a volume.

## Leases

`GET …/config` needs `VM.Audit`, which the `read` lease has. A config PUT uses the cached
`provision` lease. A create, resize or delete mints a fresh one and polls its task with it.
