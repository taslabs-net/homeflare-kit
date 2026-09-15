---
'@homeflare/alchemy': minor
---

New package: custom Alchemy providers for gaps the vendor SDK leaves.

**`R2BucketLock`** — an R2 bucket's lock rules, declared rather than applied by hand. A
lock rule is a retention floor: while a rule covers an object, no API call, no lifecycle
rule and no credential can delete it.

★ Alchemy 2.0.0-beta.77 has no lock property anywhere in its R2 namespace, so the
alternative was a runbook step a human runs once — and a plan can never show a missing
runbook step. Covering the gap with a resource makes the drift visible in `plan`.

⛔ Deletion is refused by design: removing a lock removes a retention floor, which is the
one operation this resource exists to make hard.

⚠️ `alchemy`, `cloudflare` and `effect` are **peers**, not dependencies — Alchemy's
resource registry and Effect's context both break if two copies load in one process.
