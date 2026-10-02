---
'@homeflare/config': minor
---

pre-push runs each test lane with `TMPDIR` set to a fresh directory and fails the push if anything is left, naming the leaked prefixes and how many entries share each one. Cleanup failures are reported without masking the test result or leak evidence. A tracked test file that hardcodes a `/tmp`, `/private/tmp`, or `/var/tmp` path fails the same hook unless that line, or the line above, carries a `tmp-allow:` reason; ignored nested checkouts are excluded.
