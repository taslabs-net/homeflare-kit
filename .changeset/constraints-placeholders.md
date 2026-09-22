---
'@homeflare/alchemy': patch
---

Estate topology out of the constraint proofs. PR #118's create-form proofs used the real
declarations verbatim, which put a metrics hostname, a cluster's `api-path-prefix` and three Ceph
pool names into `src` — and `src` ships in the npm tarball of a public repository, so they would
have stayed in the git history forever. `lxc-harness.ts` states the rule and these tests did not
follow it: a production-SHAPED declaration with placeholder values, because the proof is about
which keys the create form sends and which bounds they face, never about the strings.

No behaviour changes; the same forms are checked against the same tables.
