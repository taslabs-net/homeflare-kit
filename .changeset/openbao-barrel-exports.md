---
'@homeflare/alchemy': patch
---

Export `BaoMount` and `BaoAuthRole` from `@homeflare/alchemy/openbao`.

The docs already showed `import { BaoMount } from '@homeflare/alchemy/openbao'`, but the barrel only shipped the providers. Stacks constructing those resources had to import from internals.
