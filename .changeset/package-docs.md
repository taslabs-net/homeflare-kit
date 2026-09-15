---
'@homeflare/cloudflare': patch
'@homeflare/config': patch
'@homeflare/auth': patch
'@homeflare/ui': patch
---

Ship a README and LICENSE with every package.

`@homeflare/cloudflare`, `/ui` and `/auth` declared both in `files` and had neither on
disk, so their npm pages were blank and the tarballs carried no licence text. npm does
not error on a missing `files` entry — it omits it — so every gate here stayed green.
`@homeflare/config` never declared `LICENSE` at all.

The `ui` and `auth` READMEs now say plainly that those packages are scaffolds exporting
only `VERSION`, and `ui` documents using Kumo directly in the meantime. A bare npm page
reads as "ready", which is the more expensive mistake.
