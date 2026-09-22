/**
 * Generated pve-manager parameter constraints for `/access` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/constraints.ts
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * 27 of this product's 258 POST/PUT endpoints are tabled across all areas: the ones
 * this package writes to, named in its own source. Every other vendor write endpoint is UNTABLED
 * and therefore unchecked at plan time.
 *
 * ⚠️ A `patternSource` with no `pattern` beside it is a rule that could NOT be carried into a
 *   JavaScript RegExp faithfully (codegen/pattern.ts). It is recorded and NOT enforced.
 */
import type { EndpointConstraints } from '../../constraints.ts';

export const PVE_ACCESS_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:POST /access/groups": {
    "groupid": {"format":"pve-groupid","required":true,"type":"string"},
  },
  "pve:POST /access/roles": {
    "privs": {"format":"pve-priv-list","type":"string"},
    "roleid": {"format":"pve-roleid","required":true,"type":"string"},
  },
  "pve:POST /access/users": {
    "comment": {"maxLength":2048,"type":"string"},
    "email": {"format":"email-opt","maxLength":254,"type":"string"},
    "expire": {"minimum":0,"type":"integer"},
    "firstname": {"maxLength":1024,"type":"string"},
    "groups": {"format":"pve-groupid-list","type":"string"},
    "keys": {"pattern":"[0-9a-zA-Z!=]{0,4096}","patternSource":"[0-9a-zA-Z!=]{0,4096}","type":"string"},
    "lastname": {"maxLength":1024,"type":"string"},
    "password": {"maxLength":64,"minLength":8,"type":"string"},
    "userid": {"format":"pve-userid","maxLength":64,"required":true,"type":"string"},
  },
  "pve:PUT /access/acl": {
    "groups": {"format":"pve-groupid-list","type":"string"},
    "path": {"required":true,"type":"string"},
    "roles": {"format":"pve-roleid-list","required":true,"type":"string"},
    "tokens": {"format":"pve-tokenid-list","type":"string"},
    "users": {"format":"pve-userid-list","type":"string"},
  },
  "pve:PUT /access/groups/{groupid}": {},
  "pve:PUT /access/roles/{roleid}": {
    "privs": {"format":"pve-priv-list","type":"string"},
  },
  "pve:PUT /access/users/{userid}": {
    "comment": {"maxLength":2048,"type":"string"},
    "email": {"format":"email-opt","maxLength":254,"type":"string"},
    "expire": {"minimum":0,"type":"integer"},
    "firstname": {"maxLength":1024,"type":"string"},
    "groups": {"format":"pve-groupid-list","type":"string"},
    "keys": {"pattern":"[0-9a-zA-Z!=]{0,4096}","patternSource":"[0-9a-zA-Z!=]{0,4096}","type":"string"},
    "lastname": {"maxLength":1024,"type":"string"},
  },
};
