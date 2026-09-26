/**
 * `Unifi.AclRule`'s `matches` AND `driftOf` (B6) — both built on the ONE field list below, the
 * same `fieldDrift`-is-the-only-comparison shape `network-drift.ts`'s header explains (MEDIUM-4,
 * red team, 2026-09-26): `matches(attrs, props) === (driftOf(live, props).length === 0)` is true
 * BY CONSTRUCTION.
 *
 * ⚠️ `stripNullish: true` ON EVERY FIELD BY DEFAULT (`drift.ts`'s `defaultEqual`) — same "UniFi's
 *   JSON answers `null`, a declaration omits" tolerance `network-drift.ts` documents.
 * ⛔ `enforcingDeviceFilter`/`protocolFilter` RUN THROUGH `acl-rule-form.ts`'s normalizers on BOTH
 *   sides before comparing — never applied to only `live` or only `declared` (that specific gap is
 *   what MEDIUM-4's own mutant found in `network-drift.ts`; see its header).
 */
import type * as aclRules from '@distilled.cloud/unifi-network/access_control_acl_rules';
import { makeDriftOf } from './drift.ts';
import {
  type AclRuleAttributes,
  type AclRuleProps,
  attributesOf,
  normalizeDeviceFilter,
  normalizeProtocolFilter,
} from './acl-rule-form.ts';

const fieldDrift = makeDriftOf<AclRuleAttributes, AclRuleProps>([
  { field: 'action', live: (a) => a.action, declared: (p) => p.action },
  { field: 'description', live: (a) => a.description, declared: (p) => p.description },
  {
    field: 'destinationFilter',
    live: (a) => a.destinationFilter,
    declared: (p) => p.destinationFilter,
  },
  { field: 'enabled', live: (a) => a.enabled, declared: (p) => p.enabled },
  {
    field: 'enforcingDeviceFilter',
    live: (a) => normalizeDeviceFilter(a.enforcingDeviceFilter),
    declared: (p) => normalizeDeviceFilter(p.enforcingDeviceFilter),
  },
  { field: 'name', live: (a) => a.name, declared: (p) => p.name },
  { field: 'sourceFilter', live: (a) => a.sourceFilter, declared: (p) => p.sourceFilter },
  { field: 'type', live: (a) => a.type, declared: (p) => p.type },
  {
    field: 'protocolFilter',
    live: (a) => normalizeProtocolFilter(a.protocolFilter),
    declared: (p) => normalizeProtocolFilter(p.protocolFilter),
  },
  { field: 'networkIdFilter', live: (a) => a.networkIdFilter, declared: (p) => p.networkIdFilter },
]);

export const matches = (attributes: AclRuleAttributes, props: AclRuleProps): boolean =>
  fieldDrift(attributes, props).length === 0;

/**
 * Per-field live-vs-declared drift straight from one live read — the task's own API
 * (`driftOf(live, props)`), so `homeflare-network`'s pre-import drift check never has to derive
 * `attributesOf` itself just to call this.
 */
export const driftOf = (live: aclRules.ACLRule, props: AclRuleProps) =>
  fieldDrift(attributesOf(live, props), props);
