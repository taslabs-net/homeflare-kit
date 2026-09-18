---
'@homeflare/alchemy': patch
---

Bump Alchemy to 2.0.0-beta.79. Effect stays rc.115. 79 starts Bun with production JSX (the `jsxDEV` CLI crash on 78) and declares `mime` on cloudflare-runtime; the `mime` peer stays so existing consumer installs do not drop a required line.
