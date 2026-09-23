/**
 * Generated proxmox-backup-server parameter constraints for `/config` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/constraints.ts
 * Manifest entry: `pbs-apidoc` — proxmox-backup-server 4.2.6-1 (running 4.2.3)
 *   sha256 274ab9f6fc075aea, read on a PBS host from
 *   /usr/share/doc/proxmox-backup/html/api-viewer/apidoc.js
 *
 * 16 of this product's 144 POST/PUT endpoints are tabled across all areas: the ones
 * this package writes to, named in its own source. Every other vendor write endpoint is UNTABLED
 * and therefore unchecked at plan time.
 *
 * ⚠️ A `patternSource` with no `pattern` beside it is a rule that could NOT be carried into a
 *   JavaScript RegExp faithfully (codegen/pattern.ts). It is recorded and NOT enforced.
 * ⚠️ `pattern` IS NOT THE VENDOR'S SPELLING. For PVE it is anchored, because PVE applies
 *   `m/^$pattern$/` itself (JSONSchema.pm); for PBS it is the vendor's own, which already
 *   carries its anchors. `patternSource` is the spelling to quote at a human — param-rules.ts.
 * ⚠️ `each: true` means the value rules describe every ELEMENT of a repeated key, because the
 *   parameter is an array and stated its limits on `items`.
 */
import type { EndpointConstraints } from '../../constraints.ts';

export const PBS_CONFIG_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pbs:POST /config/datastore": {
    "backing-device": {"pattern":"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$","patternSource":"/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/","type":"string"},
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "keep-daily": {"minimum":1,"type":"integer"},
    "keep-hourly": {"minimum":1,"type":"integer"},
    "keep-last": {"minimum":1,"type":"integer"},
    "keep-monthly": {"minimum":1,"type":"integer"},
    "keep-weekly": {"minimum":1,"type":"integer"},
    "keep-yearly": {"minimum":1,"type":"integer"},
    "name": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "notification-mode": {"default":"notification-system","enum":["legacy-sendmail","notification-system"],"type":"string"},
    "notify-user": {"maxLength":64,"minLength":3,"pattern":"^(?:[^\\s:/\\x00-\\x1f\\x7f]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[^\\s:/[:cntrl:]]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"string"},
    "path": {"maxLength":4096,"minLength":1,"required":true,"type":"string"},
  },
  "pbs:POST /config/notifications/endpoints/sendmail": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "mailto": {"each":true,"maxLength":64,"minLength":2,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"array"},
    "mailto-user": {"each":true,"maxLength":64,"minLength":2,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"array"},
    "name": {"maxLength":32,"minLength":2,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "origin": {"enum":["user-created","builtin","modified-builtin"],"type":"string"},
  },
  "pbs:POST /config/notifications/endpoints/smtp": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "from-address": {"required":true,"type":"string"},
    "mailto": {"each":true,"maxLength":64,"minLength":2,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"array"},
    "mailto-user": {"each":true,"maxLength":64,"minLength":2,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"array"},
    "mode": {"default":"tls","enum":["insecure","starttls","tls"],"type":"string"},
    "name": {"maxLength":32,"minLength":2,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "origin": {"enum":["user-created","builtin","modified-builtin"],"type":"string"},
    "port": {"maximum":65535,"minimum":0,"type":"integer"},
    "server": {"required":true,"type":"string"},
  },
  "pbs:POST /config/notifications/endpoints/webhook": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "method": {"default":"post","enum":["post","put","get"],"required":true,"type":"string"},
    "name": {"maxLength":32,"minLength":2,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "origin": {"enum":["user-created","builtin","modified-builtin"],"type":"string"},
    "url": {"pattern":"^https?://(?:(?:(?:(?:(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9\\-]*[a-zA-Z0-9])?)\\.)*(?:[a-zA-Z0-9](?:[a-zA-Z0-9\\-]*[a-zA-Z0-9])?))|(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|\\[(?:(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){6})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:::(?:(?:[0-9a-fA-F]{1,4}):){5})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){4})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,1}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){3})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,2}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){2})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,3}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){1})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,4}(?:[0-9a-fA-F]{1,4}))?::)(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,5}(?:[0-9a-fA-F]{1,4}))?::)(?:[0-9a-fA-F]{1,4}))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,6}(?:[0-9a-fA-F]{1,4}))?::))))\\]))(?::(?:[0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?)|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){6})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:::(?:(?:[0-9a-fA-F]{1,4}):){5})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){4})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,1}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){3})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,2}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){2})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,3}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){1})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,4}(?:[0-9a-fA-F]{1,4}))?::)(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,5}(?:[0-9a-fA-F]{1,4}))?::)(?:[0-9a-fA-F]{1,4}))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,6}(?:[0-9a-fA-F]{1,4}))?::))))(?:/[^\u0000-\u001f]*)?$","patternSource":"/^https?://(?:(?:(?:(?:(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9\\-]*[a-zA-Z0-9])?)\\.)*(?:[a-zA-Z0-9](?:[a-zA-Z0-9\\-]*[a-zA-Z0-9])?))|(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|\\[(?:(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){6})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:::(?:(?:[0-9a-fA-F]{1,4}):){5})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){4})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,1}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){3})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,2}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){2})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,3}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){1})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,4}(?:[0-9a-fA-F]{1,4}))?::)(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,5}(?:[0-9a-fA-F]{1,4}))?::)(?:[0-9a-fA-F]{1,4}))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,6}(?:[0-9a-fA-F]{1,4}))?::))))\\]))(?::(?:[0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?)|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){6})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:::(?:(?:[0-9a-fA-F]{1,4}):){5})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){4})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,1}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){3})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,2}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){2})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,3}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){1})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,4}(?:[0-9a-fA-F]{1,4}))?::)(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,5}(?:[0-9a-fA-F]{1,4}))?::)(?:[0-9a-fA-F]{1,4}))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,6}(?:[0-9a-fA-F]{1,4}))?::))))(?:/[^\u0000-\u001f]*)?$/","required":true,"type":"string"},
  },
  "pbs:POST /config/notifications/matchers": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "mode": {"default":"all","enum":["all","any"],"type":"string"},
    "name": {"maxLength":32,"minLength":2,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "origin": {"enum":["user-created","builtin","modified-builtin"],"type":"string"},
    "target": {"each":true,"maxLength":32,"minLength":2,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"array"},
  },
  "pbs:POST /config/prune": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "id": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "keep-daily": {"minimum":1,"type":"integer"},
    "keep-hourly": {"minimum":1,"type":"integer"},
    "keep-last": {"minimum":1,"type":"integer"},
    "keep-monthly": {"minimum":1,"type":"integer"},
    "keep-weekly": {"minimum":1,"type":"integer"},
    "keep-yearly": {"minimum":1,"type":"integer"},
    "max-depth": {"maximum":7,"minimum":0,"type":"integer"},
    "ns": {"maxLength":256,"pattern":"^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$","patternSource":"/^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$/","type":"string"},
    "schedule": {"required":true,"type":"string"},
    "store": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
  },
  "pbs:POST /config/sync": {
    "active-encryption-key": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"string"},
    "associated-key": {"each":true,"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"array"},
    "burst-in": {"maxLength":64,"minLength":1,"type":"string"},
    "burst-out": {"maxLength":64,"minLength":1,"type":"string"},
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "id": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "max-depth": {"maximum":7,"minimum":0,"type":"integer"},
    "ns": {"maxLength":256,"pattern":"^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$","patternSource":"/^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$/","type":"string"},
    "owner": {"maxLength":64,"minLength":3,"pattern":"^(?:(?:[^\\s:/\\x00-\\x1f\\x7f]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)|(?:[^\\s:/\\x00-\\x1f\\x7f]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)!(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))$","patternSource":"/^(?:(?:[^\\s:/[:cntrl:]]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)|(?:[^\\s:/[:cntrl:]]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)!(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))$/","type":"string"},
    "rate-in": {"maxLength":64,"minLength":1,"type":"string"},
    "rate-out": {"maxLength":64,"minLength":1,"type":"string"},
    "remote": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"string"},
    "remote-ns": {"maxLength":256,"pattern":"^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$","patternSource":"/^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$/","type":"string"},
    "remote-store": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "store": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "sync-direction": {"default":"pull","enum":["pull","push"],"type":"string"},
    "transfer-last": {"minimum":1,"type":"integer"},
    "worker-threads": {"default":"1","maximum":32,"minimum":1,"type":"integer"},
  },
  "pbs:POST /config/verify": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "id": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "max-depth": {"default":"7","maximum":7,"minimum":0,"type":"integer"},
    "ns": {"maxLength":256,"pattern":"^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$","patternSource":"/^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$/","type":"string"},
    "outdated-after": {"minimum":0,"type":"integer"},
    "read-threads": {"default":"1","maximum":32,"minimum":1,"type":"integer"},
    "store": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","required":true,"type":"string"},
    "verify-threads": {"default":"4","maximum":32,"minimum":1,"type":"integer"},
  },
  "pbs:PUT /config/datastore/{name}": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "delete": {"each":true,"enum":["comment","gc-schedule","gc-on-unmount","prune-schedule","keep-last","keep-hourly","keep-daily","keep-weekly","keep-monthly","keep-yearly","verify-new","notify-user","notify","notification-mode","tuning","maintenance-mode","notification-thresholds","counter-reset-schedule"],"type":"array"},
    "digest": {"pattern":"^[a-f0-9]{64}$","patternSource":"/^[a-f0-9]{64}$/","type":"string"},
    "keep-daily": {"minimum":1,"type":"integer"},
    "keep-hourly": {"minimum":1,"type":"integer"},
    "keep-last": {"minimum":1,"type":"integer"},
    "keep-monthly": {"minimum":1,"type":"integer"},
    "keep-weekly": {"minimum":1,"type":"integer"},
    "keep-yearly": {"minimum":1,"type":"integer"},
    "notification-mode": {"default":"notification-system","enum":["legacy-sendmail","notification-system"],"type":"string"},
    "notify-user": {"maxLength":64,"minLength":3,"pattern":"^(?:[^\\s:/\\x00-\\x1f\\x7f]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[^\\s:/[:cntrl:]]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"string"},
  },
  "pbs:PUT /config/notifications/endpoints/sendmail/{name}": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "delete": {"each":true,"enum":["author","comment","disable","from-address","mailto","mailto-user"],"type":"array"},
    "digest": {"pattern":"^[a-f0-9]{64}$","patternSource":"/^[a-f0-9]{64}$/","type":"string"},
    "mailto": {"each":true,"maxLength":64,"minLength":2,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"array"},
    "mailto-user": {"each":true,"maxLength":64,"minLength":2,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"array"},
  },
  "pbs:PUT /config/notifications/endpoints/smtp/{name}": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "delete": {"each":true,"enum":["author","comment","disable","mailto","mailto-user","password","port","username"],"type":"array"},
    "digest": {"pattern":"^[a-f0-9]{64}$","patternSource":"/^[a-f0-9]{64}$/","type":"string"},
    "mailto": {"each":true,"maxLength":64,"minLength":2,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"array"},
    "mailto-user": {"each":true,"maxLength":64,"minLength":2,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"array"},
    "mode": {"default":"tls","enum":["insecure","starttls","tls"],"type":"string"},
    "port": {"maximum":65535,"minimum":0,"type":"integer"},
  },
  "pbs:PUT /config/notifications/endpoints/webhook/{name}": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "delete": {"each":true,"enum":["comment","disable","header","body","secret"],"type":"array"},
    "digest": {"pattern":"^[a-f0-9]{64}$","patternSource":"/^[a-f0-9]{64}$/","type":"string"},
    "method": {"default":"post","enum":["post","put","get"],"type":"string"},
    "url": {"pattern":"^https?://(?:(?:(?:(?:(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9\\-]*[a-zA-Z0-9])?)\\.)*(?:[a-zA-Z0-9](?:[a-zA-Z0-9\\-]*[a-zA-Z0-9])?))|(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|\\[(?:(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){6})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:::(?:(?:[0-9a-fA-F]{1,4}):){5})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){4})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,1}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){3})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,2}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){2})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,3}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){1})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,4}(?:[0-9a-fA-F]{1,4}))?::)(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,5}(?:[0-9a-fA-F]{1,4}))?::)(?:[0-9a-fA-F]{1,4}))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,6}(?:[0-9a-fA-F]{1,4}))?::))))\\]))(?::(?:[0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?)|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){6})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:::(?:(?:[0-9a-fA-F]{1,4}):){5})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){4})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,1}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){3})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,2}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){2})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,3}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){1})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,4}(?:[0-9a-fA-F]{1,4}))?::)(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,5}(?:[0-9a-fA-F]{1,4}))?::)(?:[0-9a-fA-F]{1,4}))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,6}(?:[0-9a-fA-F]{1,4}))?::))))(?:/[^\u0000-\u001f]*)?$","patternSource":"/^https?://(?:(?:(?:(?:(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9\\-]*[a-zA-Z0-9])?)\\.)*(?:[a-zA-Z0-9](?:[a-zA-Z0-9\\-]*[a-zA-Z0-9])?))|(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|\\[(?:(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){6})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:::(?:(?:[0-9a-fA-F]{1,4}):){5})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){4})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,1}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){3})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,2}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){2})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,3}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){1})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,4}(?:[0-9a-fA-F]{1,4}))?::)(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,5}(?:[0-9a-fA-F]{1,4}))?::)(?:[0-9a-fA-F]{1,4}))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,6}(?:[0-9a-fA-F]{1,4}))?::))))\\]))(?::(?:[0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?)|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){6})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:::(?:(?:[0-9a-fA-F]{1,4}):){5})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){4})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,1}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){3})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,2}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){2})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,3}(?:[0-9a-fA-F]{1,4}))?::(?:(?:[0-9a-fA-F]{1,4}):){1})(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,4}(?:[0-9a-fA-F]{1,4}))?::)(?:(?:(?:(?:(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9])\\.){3}(?:25[0-5]|(?:2[0-4]|1[0-9]|[1-9])?[0-9]))|(?:[0-9a-fA-F]{1,4}):(?:[0-9a-fA-F]{1,4}))))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,5}(?:[0-9a-fA-F]{1,4}))?::)(?:[0-9a-fA-F]{1,4}))|(?:(?:(?:(?:(?:[0-9a-fA-F]{1,4}):){0,6}(?:[0-9a-fA-F]{1,4}))?::))))(?:/[^\u0000-\u001f]*)?$/","type":"string"},
  },
  "pbs:PUT /config/notifications/matchers/{name}": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "delete": {"each":true,"enum":["comment","disable","invert-match","match-calendar","match-field","match-severity","mode","target"],"type":"array"},
    "digest": {"pattern":"^[a-f0-9]{64}$","patternSource":"/^[a-f0-9]{64}$/","type":"string"},
    "mode": {"default":"all","enum":["all","any"],"type":"string"},
    "target": {"each":true,"maxLength":32,"minLength":2,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"array"},
  },
  "pbs:PUT /config/prune/{id}": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "delete": {"each":true,"enum":["comment","disable","ns","max-depth","keep-last","keep-hourly","keep-daily","keep-weekly","keep-monthly","keep-yearly"],"type":"array"},
    "digest": {"pattern":"^[a-f0-9]{64}$","patternSource":"/^[a-f0-9]{64}$/","type":"string"},
    "keep-daily": {"minimum":1,"type":"integer"},
    "keep-hourly": {"minimum":1,"type":"integer"},
    "keep-last": {"minimum":1,"type":"integer"},
    "keep-monthly": {"minimum":1,"type":"integer"},
    "keep-weekly": {"minimum":1,"type":"integer"},
    "keep-yearly": {"minimum":1,"type":"integer"},
    "max-depth": {"maximum":7,"minimum":0,"type":"integer"},
    "ns": {"maxLength":256,"pattern":"^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$","patternSource":"/^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$/","type":"string"},
    "store": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"string"},
  },
  "pbs:PUT /config/sync/{id}": {
    "active-encryption-key": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"string"},
    "associated-key": {"each":true,"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"array"},
    "burst-in": {"maxLength":64,"minLength":1,"type":"string"},
    "burst-out": {"maxLength":64,"minLength":1,"type":"string"},
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "delete": {"each":true,"enum":["remote","owner","comment","schedule","remove-vanished","group-filter","rate-in","burst-in","rate-out","burst-out","ns","remote-ns","max-depth","transfer-last","encrypted-only","verified-only","run-on-mount","unmount-on-done","sync-direction","worker-threads","active-encryption-key","associated-key"],"type":"array"},
    "digest": {"pattern":"^[a-f0-9]{64}$","patternSource":"/^[a-f0-9]{64}$/","type":"string"},
    "max-depth": {"maximum":7,"minimum":0,"type":"integer"},
    "ns": {"maxLength":256,"pattern":"^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$","patternSource":"/^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$/","type":"string"},
    "owner": {"maxLength":64,"minLength":3,"pattern":"^(?:(?:[^\\s:/\\x00-\\x1f\\x7f]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)|(?:[^\\s:/\\x00-\\x1f\\x7f]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)!(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))$","patternSource":"/^(?:(?:[^\\s:/[:cntrl:]]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)|(?:[^\\s:/[:cntrl:]]+)@(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)!(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))$/","type":"string"},
    "rate-in": {"maxLength":64,"minLength":1,"type":"string"},
    "rate-out": {"maxLength":64,"minLength":1,"type":"string"},
    "remote": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"string"},
    "remote-ns": {"maxLength":256,"pattern":"^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$","patternSource":"/^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$/","type":"string"},
    "remote-store": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"string"},
    "store": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"string"},
    "sync-direction": {"default":"pull","enum":["pull","push"],"type":"string"},
    "transfer-last": {"minimum":1,"type":"integer"},
    "worker-threads": {"default":"1","maximum":32,"minimum":1,"type":"integer"},
  },
  "pbs:PUT /config/verify/{id}": {
    "comment": {"maxLength":128,"pattern":"^[^\\x00-\\x1f\\x7f]*$","patternSource":"/^[[:^cntrl:]]*$/","type":"string"},
    "delete": {"each":true,"enum":["ignore-verified","comment","schedule","outdated-after","ns","max-depth","read-threads","verify-threads"],"type":"array"},
    "digest": {"pattern":"^[a-f0-9]{64}$","patternSource":"/^[a-f0-9]{64}$/","type":"string"},
    "max-depth": {"default":"7","maximum":7,"minimum":0,"type":"integer"},
    "ns": {"maxLength":256,"pattern":"^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$","patternSource":"/^(?:(?:(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)/){0,7}(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*))?$/","type":"string"},
    "outdated-after": {"minimum":0,"type":"integer"},
    "read-threads": {"default":"1","maximum":32,"minimum":1,"type":"integer"},
    "store": {"maxLength":32,"minLength":3,"pattern":"^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$","patternSource":"/^(?:[A-Za-z0-9_][A-Za-z0-9._\\-]*)$/","type":"string"},
    "verify-threads": {"default":"4","maximum":32,"minimum":1,"type":"integer"},
  },
};
