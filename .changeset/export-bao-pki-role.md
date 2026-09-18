---
'@homeflare/alchemy': patch
---

Export `BaoPkiRole` and `BaoSshRole` from `@homeflare/alchemy/openbao`. The barrel already shipped both providers; stacks constructing either role had to import the resource from internals.
