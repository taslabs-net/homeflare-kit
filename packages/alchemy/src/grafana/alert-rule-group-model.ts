/**
 * Pure functions over one declared alert rule within a `Grafana.AlertRuleGroup` — no SDK call, no
 * Effect. Split out of `alert-rule-group.ts` the same way `dashboard-model.ts` is split out of
 * `dashboard.ts`: keeps that file under the house's 250-line cap, and lets the volatile-field
 * normalization be exercised directly in a test without a fake Grafana in the way.
 */
import type * as grafana from '@distilled.cloud/grafana';

/** One declared rule — the SDK's own `ProvisionedAlertRuleInput` shape, minus the three fields
 *  this resource derives from the GROUP itself (never declared per-rule) and `uid` widened from
 *  optional to required — see alert-rule-group.ts's file header for the uid-required doctrine. */
export type AlertRuleInput = Omit<
  grafana.ProvisionedAlertRuleInput,
  'folderUID' | 'orgID' | 'ruleGroup' | 'uid'
> & { uid: string };

/** Grafana injects/reassigns these on every write; a declared rule never sets them meaningfully.
 *  MEASURED against `ProvisionedAlertRule` (services/grafana.ts): `id` is the internal numeric row
 *  id, `updated` a server-set timestamp — neither exists on `ProvisionedAlertRuleInput` (the WRITE
 *  shape) at all, only on the READ shape, confirming both are Grafana-managed, not declarable.
 *  `provenance` is likewise read-only, but handled separately by `alerting-provenance.ts`'s
 *  refusal rather than compared here: an object this family just wrote reads back with
 *  `provenance: "api"`, which the DECLARATION never sets, so comparing it here would show a false
 *  `update` on every rule this family itself owns — the refusal already gives it the attention it
 *  needs, before this comparison ever runs. */
const RULE_VOLATILE_FIELDS = ['id', 'updated', 'provenance'] as const;

/** `folderUID`/`ruleGroup`/`orgID` are forced to the group's own values (mirrors
 *  `dashboard-model.ts`'s `normalizeModel` forcing `uid`) — a rule's declaration never repeats its
 *  own group/folder, and a rule pasted from Grafana's own export always embeds whatever it read at
 *  export time, which forcing to canonical values makes comparable regardless.
 *  ⚠️ `orgID` DEFAULTS TO `1` — NOT MEASURED against a multi-org instance. Every Grafana instance
 *  this house runs is single-org (grafana.md's own credentials section has no org-selecting
 *  example); `GrafanaTarget.orgId` exists for a future multi-org target but a rule's own spec
 *  functions have no access to it (unlike credentials, it is not ambient context here). A
 *  multi-org declaration would need an explicit `orgID` prop added to `AlertRuleInput` — not
 *  attempted here since no live target needs it yet. */
export const normalizeRule = (
  rule: Record<string, unknown>,
  folderUid: string,
  group: string,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rule)) {
    if (key === 'folderUID' || key === 'ruleGroup' || key === 'orgID') continue;
    if ((RULE_VOLATILE_FIELDS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  out.folderUID = folderUid;
  out.ruleGroup = group;
  out.orgID = 1;
  return out;
};

/** The full wire body for one rule on `routePutAlertRuleGroup` — the group-derived fields filled
 *  in, `orgID` defaulted per the note above. */
export const toWireRule = (
  rule: AlertRuleInput,
  folderUid: string,
  group: string,
): grafana.ProvisionedAlertRuleInput => ({
  ...rule,
  folderUID: folderUid,
  orgID: 1,
  ruleGroup: group,
});
