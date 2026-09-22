---
'@homeflare/alchemy': patch
---

Adversarial review of the vendor-constraint guard, same day it shipped: two rule kinds were passing
through it unchecked, and the coverage report did not know the guard existed.

⛔ **PVE anchors every pattern and the tables did not.** MEASURED read-only on a cluster node,
`/usr/share/perl5/PVE/JSONSchema.pm:1636`: `if ($value !~ m/^$pattern$/)`. The published pattern is
the INSIDE of an anchored match — PVE ships `[A-Za-z][A-Za-z0-9\-\_]+` for a firewall alias name —
and `RegExp.test` is a search, so `ok name!` matched on its `ok`, planned clean and was rejected by
PVE with the 400 the guard exists to prevent. All eleven PVE patterns in the tables were toothless
this way. The anchoring is textual rather than `(?:…)`, because Perl's is: three of PVE's 72
patterns carry a top-level `|`, and `^a|b$` is not `^(?:a|b)$`. `\n?` before the `$` is Perl's `$`,
which matches before a final newline where JavaScript's does not — without it the guard would refuse
values PVE accepts, which is worse than the 400. PBS is untouched: all 37 of its patterns already
carry their own `^…$` and Rust's `is_match` is a search.

⛔ **An array states its rules on `items`, and the emitter read only the parameter.** 30 tabled
parameters are arrays and 11 state real limits one level down — PBS `target` (2–32 chars, a name
pattern), `associated-key`, the `delete` enums, PVE `secondary-controllers` (max 64). `violations`
was already checking every element of a repeated key against a row that had no rules in it. Those
rules now merge into the row, which says `each: true`; `required` is never taken from `items`.

⛔ **`patternFlags` is emitted instead of discarded.** `translatePattern` lifts PBS's leading `(?m)`
to a flag and the first generation returned it and threw it away, so a multi-line rule would have
been enforced with single-line semantics. No tabled endpoint uses one today; this is the guard for
the day one does.

⛔ **`docs/api-coverage.md` called the 128-character comment unenforced.** It was generated from the
vendor schema alone, hours after the tables started enforcing 321 rows of it, so the gap column
counted every rule the guard had just closed — including the one the report opens by describing.
`POST /config/verify` now reads `unenforced: []`, PBS's owned gap falls 144 → 62 and PVE's 545 →
490, and a `format` is still never subtracted because the tables record the name and check nothing.

⛔ **The two manifests named two different PVE schemas.** `codegen/manifest.json` said 9.2.11 and
`schemas/manifest.json` said 9.2.4 — both true of this genuinely mixed-version cluster, differing by
two write endpoints, and nothing said so. Both now name the same bytes and the same versioned cache
filename, and `tests/schema-manifest.test.ts` fails if they ever diverge again.

New tests: `constraints-dialect.test.ts` holds a mutant for each newly enforced kind, and
`constraints-live.test.ts` runs all ten objects of the live PBS inventory — the real ids, stores,
schedules and retention values, comment text replaced by same-length filler because this package is
public — through their create AND update tables expecting zero violations, which is the false
positive this feature could itself cause. `constraints.test.ts` is split at the 250-line house cap.
