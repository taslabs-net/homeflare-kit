---
'@homeflare/config': minor
---

pre-push runs each test lane with `TMPDIR` set to a fresh directory and fails the push if anything is left, naming the leaked prefixes and how many entries share each one. A test file that hardcodes a `/tmp` path fails the same hook unless that line, or the line above, carries a `tmp-allow:` reason.
