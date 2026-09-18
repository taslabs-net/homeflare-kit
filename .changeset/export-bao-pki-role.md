---
'@homeflare/alchemy': patch
---

Export `BaoPkiRole` from `@homeflare/alchemy/openbao`. The barrel already shipped `BaoPkiRoleProvider`; stacks constructing the role had to import the resource from internals.
