---
'@homeflare/kit': patch
---

No consumer-visible change. Release tooling only: the publish step now streams npm's
output and confirms each version against the registry before reporting success.
