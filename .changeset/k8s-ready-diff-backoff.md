---
'@homeflare/alchemy': patch
---

Kubernetes.Ready: `diff` plans `update` on a transient instead of failing the plan, and a hung apiserver is polled with back-off and no further GETs after a timeout (upstream `readObject` cannot abort a socket).
