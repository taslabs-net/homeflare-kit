---
'@homeflare/alchemy': patch
---

Two ways a `Remote.File` managed region could break its own promise, and a systemd rename that
refused too late. All three found by reviewing the merged diff and reproduced against the fake
Linux host before anything was changed.

🔴 **A REGION RENAME LEFT THE OLD BLOCK IN THE FILE FOREVER.** Only `path` was identity, so changing
`region.name` — or its `comment` token, which is part of the marker line — planned a routine
`update`: the new markers were spliced in, the old ones were never touched, and `delete` could only
ever look for the name in state, which was now the new one. Reproduced: a vendor file ended up
carrying two `BEGIN` blocks and destroying the resource removed one of them. For the named
consumers that is two `anchor` lines in a packet filter and a duplicate entry in a host table, with
nothing in the stack able to take either back. A rename is now a MOVE: the new block is written and
verified, then the old one is removed, and the stored digest is re-read afterwards so it describes
the file that is actually there.

🔴 **DROPPING `region` TOOK OVER A FILE THIS RESOURCE DID NOT OWN.** Same cause, worse effect: the
plan said `update` and the apply replaced every byte of the other owner's file with this resource's
few lines. That is the one thing the managed-region design exists to make impossible. A flip between
owning the whole file and owning a block — in either direction, at the same path — is now a
PLAN-TIME REFUSAL, because neither order is safe: writing the whole file first destroys the other
owner's bytes before anything can be undone, and removing the block first destroys our own claim and
then refuses. Destroy the resource and declare a new one.

🔴 **A `Systemd.Unit` RENAME REFUSED AFTER THE OLD UNIT WAS ALREADY GONE.** `diffUnit` returned
`{ action: 'replace', deleteFirst: true }` after validation and a write-permission check alone, and
Alchemy deletes the old unit — stop, disable, remove the file — BEFORE reconciling the new one. A
rename onto a masked name, or onto a unit file belonging to something else, therefore took the
service down and only then refused. The masked check, the foreign-unit-file check and the runner's
`checkWrite` now run in the plan, read-only, exactly as the launchd family's `assertReplaceable`
already did. ⛔ This forbids nothing that used to work: a fresh replace's new generation is never
adoptable, so the identical refusal was always going to fire — just later, and with nothing running.
The name-only half of the check also runs on the rename that `diffHandler` spots while `content` is
still an Output.
