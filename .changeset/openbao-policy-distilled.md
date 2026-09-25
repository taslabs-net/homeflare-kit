---
'@homeflare/alchemy': patch
---

Run every OpenBao ACL policy lifecycle call, including rename collision reads, through
the distilled OpenBao SDK. Preserve shared concurrency limits, agent sockets, runtime
credentials, namespace selection, and token trace redaction. Only typed missing-policy
errors mean absence; refused and malformed reads fail. Reads retain bounded transport
retries; a policy write sends the full policy text every time, so it retries a transport
failure the same bounded way; a delete makes one attempt after an uncertain response.
Checked against the OpenBao 2.6.2 generated schema and pinned vendor policy handlers.
