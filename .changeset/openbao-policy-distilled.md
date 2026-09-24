---
'@homeflare/alchemy': patch
---

Run every OpenBao ACL policy lifecycle call, including rename collision reads, through
the distilled OpenBao SDK. Preserve shared concurrency limits, agent sockets, runtime
credentials, namespace selection, and token trace redaction. Only typed missing-policy
errors mean absence; refused and malformed reads fail. Reads retain bounded transport
retries; writes are not retried after an uncertain response.
Checked against the OpenBao 2.6.2 generated schema and pinned vendor policy handlers.
