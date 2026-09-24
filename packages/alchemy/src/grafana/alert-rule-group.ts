/**
 * `Grafana.AlertRuleGroup` — one Grafana alert rule GROUP, keyed by `(folderUid, group)`.
 *
 * ★ GROUP, NOT PER-RULE — THE UNIT CHOICE, JUSTIFIED. MEASURED against the SDK's generated
 *   operations: `PUT /v1/provisioning/folder/{FolderUID}/rule-groups/{Group}`
 *   (`routePutAlertRuleGroup`) takes the evaluation `interval` AND the full ordered `rules[]`
 *   TOGETHER, replacing the whole group in one call (`RoutePutAlertRuleGroupRequest.rules:
 *   Array<ProvisionedAlertRuleInput>`) — the individual `routePostAlertRule`/`routePutAlertRule`
 *   operations have no `interval` field at all and cannot reorder rules within a group. Declaring
 *   rules one at a time (`Grafana.AlertRule`) would leave a group's evaluation interval and rule
 *   order — both real, load-bearing Grafana state — either undeclarable or racy across N
 *   independent resources with no shared source of truth for them. Grafana's own docs describe
 *   `X-Disable-Provenance` on the rule-group PUT as setting "the provenance for the rule group AND
 *   ALL ITS ALERT RULES" — further evidence the group, not the rule, is Grafana's own natural unit
 *   of ownership here. Mirrors Terraform's own `grafana_rule_group` resource, which takes the
 *   identical shape (a list of rules under one folder/name/interval).
 *
 * ★ `uid` IS REQUIRED ON EVERY DECLARED RULE — same doctrine as every other resource in this
 *   family (`AlertRuleInput` in `alert-rule-group-model.ts`). `ProvisionedAlertRuleInput.uid` is
 *   optional on the wire (Grafana assigns one if omitted), but locating a specific rule this
 *   resource didn't just create would then mean matching by title — the same ambiguity
 *   `resource.ts`'s header and netbox's `soleMatch` exist to catch everywhere else in this family.
 *
 * ⛔ RULE ORDER IS SIGNIFICANT — NEVER REORDERED. `subset-match.ts`'s array comparison is already
 *   position-significant (length, then element-wise) — this resource relies on that as-is; nothing
 *   here re-sorts `rules` before comparing. Declaring rules in a different order than what is live
 *   is a genuine content change (Grafana evaluates and displays a group's rules in array order),
 *   not a cosmetic one.
 *
 * ⛔ A FOREIGN-PROVENANCE GROUP REFUSES EVERY UPDATE AND DESTROY — `alerting-provenance.ts`. Unlike
 *   `ContactPoint`/`MessageTemplate`, `AlertRuleGroup` (the type `routeGetAlertRuleGroup` returns)
 *   carries NO top-level `provenance` field — MEASURED: `folderUid?`/`interval?`/`rules?`/`title?`
 *   only. Each RULE inside `rules[]` has its own (`ProvisionedAlertRule.provenance`), and Grafana's
 *   docs say a new rule's provenance "must match the provenance value configured for its rule
 *   group" — so this resource checks every live rule and refuses if ANY carries a foreign
 *   provenance, naming the first one found. An empty live group (no rules yet) has nothing to check
 *   and is never foreign. `create` is never at risk: it only runs when `fetchLive` already found
 *   nothing.
 *
 * ⛔ A DECLARED GROUP WHOSE FOLDER DOES NOT EXIST REFUSES — IT IS NEVER AUTO-CREATED. This resource
 *   makes no "does the folder exist" call of its own and does not depend on or invoke
 *   `Grafana.Folder`'s create path. MEASURED: `RoutePutAlertRuleGroupError` is
 *   `BadRequest | Forbidden | GrafanaOpError` — no `NotFound` case at all — so a nonexistent
 *   `folderUid` fails the PUT as a typed `BadRequest`, left uncaught and propagated (the house rule
 *   against folding a non-not-found error into absent), which fails the whole `reconcile` and stops
 *   the deploy. Declare a `Grafana.Folder` for it first — the two resources sharing one `folderUid`
 *   string is the dependency; auto-creating a folder from inside this resource would blur ownership
 *   the same way `provisioned.ts`'s "one owner per resource" principle already guards against
 *   elsewhere in this family. ⚠️ NOT RE-MEASURED against a live instance in this PR — inferred from
 *   the declared error union, the same evidentiary bar `folder.ts`'s own `version` note uses.
 *
 * ⛔ DELETE DEFAULTS TO `retain` — DELETING A GROUP DELETES EVERY RULE IN IT IN ONE CALL
 *   (`routeDeleteAlertRuleGroup`, whole-group DELETE). The same multi-object-cascade class
 *   `Grafana.Folder`/`openbao/mount.ts` already guard with `defaultRemovalPolicy: 'retain'` — a
 *   stack that wants the cascade opts in with `.pipe(RemovalPolicy.destroy())`; `destroy` below
 *   still implements the real DELETE in full either way (S11).
 *
 * ⚠️ `orgID` DEFAULTS TO `1` ON EVERY WRITTEN RULE — see `alert-rule-group-model.ts`'s own note;
 *   not measured against a multi-org instance, since none exists in this house yet.
 *
 * ⚠️ `X-Disable-Provenance` IS NEVER SET — same reasoning as `contact-point.ts`'s file header.
 *
 * ⚠️ A WHOLE-GROUP WRITE SILENTLY DROPS ANY LIVE RULE THE DECLARATION DOESN'T MENTION — flagged by
 *   an adversarial review of this PR. Unlike every other resource in this family, this one does
 *   not compare one object's fields; `update`/`diff` REPLACE an entire collection, so a live rule
 *   with no counterpart in `props.rules` (e.g. one a human just added in the Grafana UI, ordinary
 *   writable provenance — nothing for the refusal above to catch) is removed with no error and no
 *   distinct `Diff` action to report it under. This is accepted by design — the group is still the
 *   unit — but never SILENT: `alert-rule-group-drop-warning.ts`'s `warnOnDroppedRules` logs every
 *   dropped rule by title and uid, called from both the custom `diff` below (so `bun run plan`
 *   shows it before anything is written) and from `update` itself (so it is visible wherever
 *   `reconcile` runs directly too).
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as grafana from '@distilled.cloud/grafana';
import * as Effect from 'effect/Effect';
import { warnOnDroppedRules } from './alert-rule-group-drop-warning.ts';
import { type AlertRuleInput, normalizeRule, toWireRule } from './alert-rule-group-model.ts';
import {
  type GrafanaProvisionedObjectError,
  isForeignProvenance,
  refuseIfForeignProvenance,
} from './alerting-provenance.ts';
import { type GrafanaSpec, grafanaHandlers } from './resource.ts';
import { declaredContentMatches } from './subset-match.ts';

export type { AlertRuleInput };

export interface AlertRuleGroupProps {
  folderUid: string;
  group: string;
  /** Evaluation interval, in seconds. */
  interval: number;
  /** Order is significant — see the file header. */
  rules: ReadonlyArray<AlertRuleInput>;
}

export interface AlertRuleGroupAttributes {
  folderUid: string;
  group: string;
  interval: number;
  rules: ReadonlyArray<Record<string, unknown>>;
}

export interface GrafanaAlertRuleGroup extends Resource<
  'Grafana.AlertRuleGroup',
  AlertRuleGroupProps,
  AlertRuleGroupAttributes,
  never
> {}

export const GrafanaAlertRuleGroup = Resource<GrafanaAlertRuleGroup>('Grafana.AlertRuleGroup', {
  defaultRemovalPolicy: 'retain',
});

/** The first live rule whose provenance this family may not write to, or `undefined` when every
 *  rule (including none at all) is writable. */
const findForeignRule = (
  rules: ReadonlyArray<grafana.ProvisionedAlertRule> | undefined,
): grafana.ProvisionedAlertRule | undefined =>
  (rules ?? []).find((rule) => isForeignProvenance(rule.provenance));

const body = (props: AlertRuleGroupProps) => ({
  folderUid: props.folderUid,
  interval: props.interval,
  rules: props.rules.map((rule) => toWireRule(rule, props.folderUid, props.group)),
  title: props.group,
});

const refuseForForeignRule = (props: AlertRuleGroupProps, foreign: grafana.ProvisionedAlertRule) =>
  refuseIfForeignProvenance(
    'Grafana.AlertRuleGroup',
    `${props.folderUid}/${props.group}`,
    foreign.provenance,
  );

const declaredUids = (props: AlertRuleGroupProps): ReadonlySet<string> =>
  new Set(props.rules.map((rule) => rule.uid));

export const spec: GrafanaSpec<
  AlertRuleGroupProps,
  grafana.AlertRuleGroup,
  AlertRuleGroupAttributes,
  | grafana.RouteGetAlertRuleGroupError
  | grafana.RoutePutAlertRuleGroupError
  | grafana.RouteDeleteAlertRuleGroupError
  | GrafanaProvisionedObjectError
> = {
  attributes: (live, props) => ({
    folderUid: live.folderUid ?? props.folderUid,
    group: props.group,
    interval: live.interval ?? 0,
    rules: (live.rules ?? []).map((rule) =>
      normalizeRule(rule as unknown as Record<string, unknown>, props.folderUid, props.group),
    ),
  }),
  create: (props) =>
    grafana.routePutAlertRuleGroup({
      FolderUID: props.folderUid,
      Group: props.group,
      ...body(props),
    }),
  destroy: (props, live) =>
    Effect.gen(function* () {
      const foreign = findForeignRule(live.rules);
      if (foreign !== undefined) return yield* refuseForForeignRule(props, foreign);
      yield* grafana.routeDeleteAlertRuleGroup({ FolderUID: props.folderUid, Group: props.group });
    }),
  fetchLive: (props) =>
    grafana
      .routeGetAlertRuleGroup({ FolderUID: props.folderUid, Group: props.group })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) =>
    attributes.interval === props.interval &&
    declaredContentMatches(
      props.rules.map((rule) =>
        normalizeRule(rule as unknown as Record<string, unknown>, props.folderUid, props.group),
      ),
      attributes.rules,
    ),
  update: (props, live) =>
    Effect.gen(function* () {
      const foreign = findForeignRule(live.rules);
      if (foreign !== undefined) return yield* refuseForForeignRule(props, foreign);
      yield* warnOnDroppedRules(props.folderUid, props.group, declaredUids(props), live.rules);
      yield* grafana.routePutAlertRuleGroup({
        FolderUID: props.folderUid,
        Group: props.group,
        ...body(props),
      });
    }),
};

/**
 * ⚠️ A LOCAL REIMPLEMENTATION OF `resource.ts`'s GENERIC `diff`, NOT A WRAP OF IT — deliberately.
 *   The generic `grafanaOperations(spec).diff` fetches live and maps it to `Attributes` entirely
 *   inside itself, with no seam to run the drop warning against the rules it read; wrapping it
 *   would mean a SECOND live fetch just to see what it saw. This resource's `diff` is the ONLY one
 *   in the family that needs a resource-specific side effect mid-comparison, so it re-reads
 *   `resource.ts`'s own logic here rather than changing the shared engine every other resource
 *   also uses. Keep this in sync with `resource.ts`'s `grafanaOperations.diff` if that ever
 *   changes shape.
 */
const diff = ({
  news,
  output,
}: {
  news: Input<AlertRuleGroupProps>;
  output: AlertRuleGroupAttributes | undefined;
}) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* spec.fetchLive(news);
    if (live === undefined) return { action: 'update' } as const;
    yield* warnOnDroppedRules(news.folderUid, news.group, declaredUids(news), live.rules);
    const mapped = spec.attributes(live, news);
    return mapped !== undefined && spec.matches(mapped, news)
      ? ({ action: 'noop' } as const)
      : ({ action: 'update' } as const);
  });

export const handlers = { ...grafanaHandlers(spec), diff };

export const GrafanaAlertRuleGroupProvider = () =>
  Provider.effect(
    GrafanaAlertRuleGroup,
    Effect.succeed(GrafanaAlertRuleGroup.Provider.of(handlers)),
  );
