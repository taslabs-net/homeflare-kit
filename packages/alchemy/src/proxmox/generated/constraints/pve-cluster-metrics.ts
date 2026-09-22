/**
 * Generated pve-manager parameter constraints for `/cluster/metrics` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/constraints.ts
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * 59 of this product's 258 POST/PUT endpoints are tabled across all areas: the ones
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

export const PVE_CLUSTER_METRICS_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:POST /cluster/metrics/server/{id}": {
    "influxdbproto": {"default":"udp","enum":["udp","http","https"],"type":"string"},
    "max-body-size": {"default":"25000000","minimum":1,"type":"integer"},
    "mtu": {"default":"1500","maximum":65536,"minimum":512,"type":"integer"},
    "otel-compression": {"default":"gzip","enum":["none","gzip"],"type":"string"},
    "otel-headers": {"maxLength":1024,"type":"string"},
    "otel-max-body-size": {"default":"10000000","minimum":1024,"type":"integer"},
    "otel-protocol": {"default":"https","enum":["http","https"],"type":"string"},
    "otel-resource-attributes": {"maxLength":1024,"type":"string"},
    "otel-timeout": {"default":"5","maximum":10,"minimum":1,"type":"integer"},
    "path": {"format":"graphite-path","type":"string"},
    "port": {"maximum":65536,"minimum":1,"required":true,"type":"integer"},
    "proto": {"enum":["udp","tcp"],"type":"string"},
    "server": {"format":"address","required":true,"type":"string"},
    "timeout": {"default":"1","minimum":0,"type":"integer"},
    "type": {"enum":["graphite","influxdb","opentelemetry"],"format":"pve-configid","required":true,"type":"string"},
  },
  "pve:PUT /cluster/metrics/server/{id}": {
    "delete": {"format":"pve-configid-list","maxLength":4096,"type":"string"},
    "digest": {"maxLength":64,"type":"string"},
    "influxdbproto": {"default":"udp","enum":["udp","http","https"],"type":"string"},
    "max-body-size": {"default":"25000000","minimum":1,"type":"integer"},
    "mtu": {"default":"1500","maximum":65536,"minimum":512,"type":"integer"},
    "otel-compression": {"default":"gzip","enum":["none","gzip"],"type":"string"},
    "otel-headers": {"maxLength":1024,"type":"string"},
    "otel-max-body-size": {"default":"10000000","minimum":1024,"type":"integer"},
    "otel-protocol": {"default":"https","enum":["http","https"],"type":"string"},
    "otel-resource-attributes": {"maxLength":1024,"type":"string"},
    "otel-timeout": {"default":"5","maximum":10,"minimum":1,"type":"integer"},
    "path": {"format":"graphite-path","type":"string"},
    "port": {"maximum":65536,"minimum":1,"required":true,"type":"integer"},
    "proto": {"enum":["udp","tcp"],"type":"string"},
    "server": {"format":"address","required":true,"type":"string"},
    "timeout": {"default":"1","minimum":0,"type":"integer"},
  },
};
