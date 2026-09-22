---
'@homeflare/alchemy': patch
'@homeflare/site': patch
---

The published sources, docs and examples no longer name the maintainer's own infrastructure.
Node names, cluster and pool names, NICs, VLANs, addresses, hostnames, guest ids, principals and
policy names in comments, fixtures and examples are now neutral placeholders: nodes `node-a`…
`node-d`, a reference cluster `C1`, documentation addresses (RFC 5737), `bao.example.internal`.
Measured facts are unchanged; only the names are. `site.example.json` names its hosts `node-a`…
`node-c`. One runtime message changed: `forgejo-bootstrap` now says to run on "the host where
Forgejo runs". The historical CHANGELOG entries are unchanged.
