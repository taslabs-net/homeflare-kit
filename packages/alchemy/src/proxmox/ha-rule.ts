/**
 * `Proxmox.HaRule` — where the CRM may place a guest, and which guests must not share a node.
 *
 * ★ THIS IS THE PVE 9 SUCCESSOR TO HA GROUPS, AND THE GROUPS ENDPOINT IS GONE. MEASURED on node-b
 *   (pve-manager/9.2.11, 2026-09-13): `pvesh get /cluster/ha/groups` answers `cannot index groups:
 *   ha groups have been migrated to rules`, and `/etc/pve/ha/` holds `rules.cfg` with no
 *   `groups.cfg` beside it. The published schema still documents groups and still offers a `group`
 *   parameter on `Proxmox.HaResource`; both are dead. Do not port them back.
 *
 * ★ ONE RESOURCE FOR BOTH RULE TYPES, ON THE ceph-daemon.ts ARGUMENT AND AFTER READING BOTH
 *   PLUGINS. `PVE::HA::Rules::NodeAffinity` and `::ResourceAffinity` share `resources`, `affinity`,
 *   `disable` and `comment`; node-affinity adds `nodes` and `strict` and nothing else diverges. The
 *   endpoint, the path, the create/update/delete calls, the `order` and `digest` traps below and
 *   the list normalisation are identical for both. Two files would have carried every one of those
 *   traps twice and let them drift.
 *   ⛔ `type` IS CREATE-ONLY. MEASURED in `/usr/share/perl5/PVE/API2/HA/Rules.pm`: `update_rule`
 *     takes the plugin from the STORED rule (`my $type = $rule->{type};`) and never rewrites it. So
 *     `attributes` reports a rule of the other type as ABSENT, which sends reconcile down the
 *     create branch and makes PVE refuse with `HA rule '<id>' already defined` — a loud, accurate
 *     error rather than a PUT pushing node-affinity fields at a resource-affinity rule.
 *     ⛔ AND YET IT IS SENT ON THE UPDATE ANYWAY, because the PUT is validated against a `oneOf`
 *       keyed on it and refuses the whole body without it. That one is worth reading in full: it
 *       is the ⛔ on `required` in ha-rule-form.ts.
 *
 * ⛔ THREE FIELDS PVE RETURNS AND NO WRITE ACCEPTS, EACH ONE A FOREVER-UPDATE IF COMPARED.
 *   `order` is an ORDINAL PVE ASSIGNS ITSELF (`$rules->{order}->{$ruleid} =
 *   PVE::HA::Rules::get_next_ordinal($rules)`) and it appears in no create or update schema at all;
 *   it is reported in attributes and never compared. `digest` is the digest of the WHOLE rules
 *   file, so it moves when a rule written for somebody else's guests moves — it is not even an
 *   attribute, for the reason ha-resource.ts gives. `errors` is PVE's own feasibility verdict,
 *   recomputed across every rule on every read; reported, never compared. See `problems` in
 *   ha-rule-form.ts.
 *
 * ⚠️ IT COMPOSES WITH `Proxmox.HaResource`, AND THE EDGE IS REAL RATHER THAN TIDY. MEASURED:
 *   `create_rule` runs `$assert_valid_resources_param`, which calls
 *   `PVE::HA::Config::service_is_configured($resource)` for every sid and dies `cannot use
 *   unmanaged resource(s) <sid>` if one is not already an HA resource. A rule naming a sid nothing
 *   has put under HA is a HARD 400, not a warning — so `resources` should be written as the
 *   HaResource's own attribute (`resources: [web.sid, db.sid]`) and let Alchemy order the deploy,
 *   not as a bare string that happens to match. `$assert_valid_nodes_param` refuses a non-existent
 *   node the same way.
 *   ⛔ AND THE EDGE RUNS BACK THE OTHER WAY, WHERE ALCHEMY CANNOT SEE IT. Destroying an
 *     `HaResource` deletes with PVE's default `purge=1`, which strips that sid out of every rule
 *     and DELETES any rule left with no members. So a plan that only removes a guest can remove
 *     this resource's object from under it; the next plan then reads absent and recreates it, or
 *     fails on the `unmanaged resource` check if the guest is gone for good.
 *
 * ⚠️ BOTH LANES ALREADY HAVE THE PRIVILEGES, WHICH IS NEW. MEASURED 2026-09-13:
 *   GET (collection and item) checks `Sys.Audit` on `/` and the built-in `PVEAuditor` holds it, so
 *   `readRole` stays the default `read` lease — unlike storage.ts and the SDN families. POST, PUT
 *   and DELETE all check `Sys.Console` on `/`, and the provision role now returns `Sys.Console` among
 *   its 27 privileges (`PROVISION_PRIVILEGES`, provision-baseline.ts). The warning in ha-resource.ts's header — that
 *   `Sys.Console` is missing — is stale; the role was widened, and the price it named still stands:
 *   `Sys.Console` is also what opens a root shell on every node.
 *
 * ⚠️ REMOVAL IS THE PLAIN DEFAULT, DELIBERATELY, AND `delete` IS THE FACTORY'S. An HA rule is
 *   exactly a line of TypeScript — nothing in it is irreplaceable the way a Ceph pool or a ZFS
 *   vdev is — so the `retain` default that resource.ts explains does not apply. Read the plan for
 *   what it is, though: while a negative resource-affinity rule is absent, nothing stops the CRM
 *   putting both halves of a pair on one node.
 *
 * ⚠️ A READ GOES THROUGH THE GROUPS MIGRATION. Every GET calls `migrate_groups_to_rules`, so on a
 *   cluster that still has `groups.cfg` the answer includes SYNTHETIC rules nobody declared. This
 *   cluster has none, so nothing is injected here; a rule id colliding with an old group name on a
 *   cluster that does would read back something this provider never wrote.
 *
 * ⚠️ A CHANGED `type` READS AS `update` IN THE PLAN AND FAILS AS "already defined" ON THE APPLY,
 *   AND THOSE TWO WORDS POINT AWAY FROM THE CAUSE. `attributes` answers undefined when the live
 *   rule's type disagrees, so `diff` takes resource.ts's `live === undefined` branch and says
 *   update; reconcile then reads undefined, POSTs, and PVE refuses because the rule is plainly
 *   there. The cause is that `type` is create-only. metric-server.ts has the same shape, so this
 *   is the package's consistent behaviour rather than a quirk of this file — but it is worth
 *   knowing before reading the error. Delete the declaration and write a new one to change a type.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { body, clearList, commentText, nodeList, problems } from './ha-rule-form.ts';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { bool, csv, int, text, withClears } from './values.ts';

export type HaRuleType = 'node-affinity' | 'resource-affinity';

/**
 * ⛔ REQUIRED ON BOTH TYPES, AND THAT IS A DELIBERATE NARROWING OF PVE'S SCHEMA. PVE makes it
 *   optional for node-affinity (defaulting to `positive`) and mandatory for resource-affinity. A
 *   provider that mirrored that has two bad options when a declaration omits it: guess `positive`,
 *   which silently flips a live `negative` rule — the one keeping two guests APART — into one that
 *   pins them together; or leave it out of the write, which makes `matches` disagree with a live
 *   `negative` rule forever while every PUT changes nothing. Requiring one word from the caller
 *   removes both.
 */
export type HaAffinity = 'positive' | 'negative';

interface HaRuleBase extends WithTarget {
  /** A `pve-configid`: a letter, then letters, digits, `-` and `_`. Identity — renaming is a new
   *  rule, and the old one stays behind exactly as `sid` does in ha-resource.ts. */
  rule: string;
  /**
   * The HA resources this rule constrains, as prefixed sids — `ct:101`, `vm:100`.
   * ⚠️ EVERY ONE MUST ALREADY BE UNDER HA. See the composition ⚠️ in the header: this is an
   *   ordering edge, and the honest way to express it is the HaResource's own `sid` attribute.
   */
  resources: readonly string[] | string;
  affinity: HaAffinity;
  /** Keep the rule in the file but stop the CRM applying it. ⛔ Clearing it needs `delete=disable`
   *  — see the ⛔ in `optional` in ha-rule-form.ts. */
  disable?: boolean;
  /** Free text shown in the HA panel. Max 4096 characters. */
  comment?: string;
}

export interface NodeAffinityRuleProps extends HaRuleBase {
  type: 'node-affinity';
  /**
   * Cluster nodes, each optionally `<node>:<priority>`. Higher priority wins; the numbers are
   * relative and nothing else. ⚠️ REQUIRED BY THE TYPE, not merely by PVE — an optional `nodes`
   * would let a declaration that cannot describe any live rule sit in a permanent update loop.
   */
  nodes: readonly string[] | string;
  /** `false` (PVE's default) makes the nodes a PREFERENCE; `true` makes them the only nodes the
   *  resources may run on, and the resources STOP when none of them is available. */
  strict?: boolean;
}

export interface ResourceAffinityRuleProps extends HaRuleBase {
  type: 'resource-affinity';
}

/**
 * ⚠️ A UNION, NOT ONE FLAT INTERFACE WITH OPTIONAL EXTRAS, because `nodes` and `strict` are not
 *   merely unused on a resource-affinity rule — PVE's oneOf declares `additionalProperties: 0`, so
 *   sending either is a 400, and comparing either would be a diff no write could ever settle. The
 *   union makes both unwritable rather than ignored.
 */
export type HaRuleProps = NodeAffinityRuleProps | ResourceAffinityRuleProps;

export interface HaRuleAttributes {
  rule: string;
  type: HaRuleType;
  /** ⚠️ NORMALISED, NOT RAW. PVE returns `join(',', sort keys %$hash)` — a re-sorted SET. */
  resources: string;
  /** ⚠️ Normalised by `nodeList`; always `''` on a resource-affinity rule, which has no nodes. */
  nodes: string;
  affinity: string;
  strict: boolean;
  disable: boolean;
  comment: string;
  /** ⛔ PVE-ASSIGNED AND UNWRITABLE. Reported so a plan can show it; never compared. */
  order: number;
  /** ⛔ PVE's feasibility verdict for this rule. Reported; never compared. */
  errors: string;
}

export interface ProxmoxHaRule extends Resource<
  'Proxmox.HaRule',
  HaRuleProps,
  HaRuleAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxHaRule = Resource<ProxmoxHaRule>('Proxmox.HaRule');

const handlers = pveHandlers<HaRuleProps, HaRuleAttributes>({
  attributes: (live, props) => {
    /**
     * ⛔ A RULE OF THE OTHER TYPE IS ANOTHER OBJECT, AND "ABSENT" IS THE HONEST ANSWER — the same
     *   move metric-server.ts makes, for the same reason: `type` cannot be changed by a PUT, so
     *   reporting the foreign rule as missing makes reconcile POST and PVE refuse because the id
     *   is taken. An older PVE that omitted `type` from the read would fall through and be trusted.
     */
    const liveType = text(live['type']);
    if (liveType !== '' && liveType !== props.type) return undefined;
    return {
      affinity: text(live['affinity']),
      comment: text(live['comment']),
      /**
       * ⚠️ ABSENT WHEN OFF, AND THAT IS NOT THE SAME AS `false` BY ACCIDENT. MEASURED in
       *   `PVE::HA::Rules::set_rule_defaults`: a default is materialised into the read only when it
       *   is TRUTHY, so `disable` (no default) and `strict` (default 0) are simply missing from an
       *   enabled, non-strict rule while `affinity` (default `positive`) is always present.
       */
      disable: bool(live['disable'], false),
      errors: problems(live['errors']),
      nodes: nodeList(typeof live['nodes'] === 'string' ? live['nodes'] : undefined),
      order: int(live['order'], 0),
      resources: csv(typeof live['resources'] === 'string' ? live['resources'] : undefined),
      rule: text(live['rule'], props.rule),
      strict: bool(live['strict'], false),
      type: props.type,
    };
  },
  collection: () => 'cluster/ha/rules',
  /** ⚠️ ONLY `rule` IS ADDED HERE: the POST is to the collection, so the id is not in the path.
   *   `type` is already in `body` — the PUT needs it too, for the reason ha-rule-form.ts gives. */
  createForm: (props) => ({ ...body(props), rule: props.rule }),
  /**
   * ⛔ ONLY FIELDS A WRITE CAN ACTUALLY SET ARE COMPARED. `order`, `errors` and `digest` are out
   *   for the reason the header gives at length — each would report an update that the PUT it
   *   triggers cannot satisfy, on every plan, forever. `rule` and `type` are out too: one is the
   *   key the object was read by, the other is refused rather than updated.
   * ⚠️ `nodes` AND `strict` ARE COMPARED ONLY ON A NODE-AFFINITY RULE. They do not exist on the
   *   other plugin, so `attributes.nodes` is `''` and `attributes.strict` is `false` there by
   *   construction — comparing them would be comparing a declaration against nothing.
   * ⚠️ THE COMMENT IS COMPARED AS PVE WILL STORE IT, not as it was declared — `commentText` and
   *   its ⛔ explain why a `%XX` in a comment does not survive the round trip.
   */
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: { create: 'pve:POST /cluster/ha/rules', update: 'pve:PUT /cluster/ha/rules/{rule}' },
  matches: (attributes, props) =>
    attributes.resources === csv(props.resources) &&
    attributes.affinity === props.affinity &&
    attributes.comment === commentText(props.comment ?? '') &&
    attributes.disable === (props.disable === true) &&
    (props.type !== 'node-affinity' ||
      (attributes.nodes === nodeList(props.nodes) &&
        attributes.strict === (props.strict === true))),
  /** ⚠️ A `pve-configid` has no `/` or `:` in it, so there is nothing here to encode. */
  path: (props) => `cluster/ha/rules/${props.rule}`,
  /**
   * ⛔ THE `delete=` HALF IS WHAT MAKES THIS SETTLE. A PUT merges into the stored rule and a
   *   `disable=0` is thrown away before the plugin sees it, so without the clear list a rule
   *   disabled by hand could never be re-enabled by a declaration and every plan would report the
   *   same update. `clearList` and `body` come off one table — see ha-rule-form.ts.
   */
  updateForm: (props) => {
    const clear = clearList(props);
    const fields = body(props);
    return withClears(fields, clear);
  },
});

/**
 * ⛔ THE EMPTY `list` FROM `pveHandlers` STANDS, AND IT COSTS NOTHING HERE TODAY.
 *   `GET /cluster/ha/rules` MEASURED `[]` on this cluster on 2026-09-13 — but the same call on a
 *   cluster somebody has used returns every rule an operator ever clicked, plus the synthetic ones
 *   the groups migration invents on read. Adopting either is how a later `alchemy destroy` removes
 *   a separation rule nobody declared. Adoption stays an explicit act.
 */
export const ProxmoxHaRuleProvider = () =>
  Provider.effect(ProxmoxHaRule, Effect.succeed(ProxmoxHaRule.Provider.of(handlers)));
