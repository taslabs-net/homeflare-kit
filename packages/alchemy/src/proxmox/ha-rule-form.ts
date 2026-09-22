/**
 * An HA rule's props as the form PVE wants, and the two lists PVE re-spells on the way back.
 *
 * ★ SPLIT OUT OF ha-rule.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is the same
 *   one metric-server-form.ts and node-network-form.ts cut: this file answers "how does a
 *   declaration become a PVE form, and what shape does PVE hand back", ha-rule.ts answers "what is
 *   an HA rule and when has it changed". Nothing here reads the cluster or decides a diff.
 *
 * ⚠️ THE `import type` BACK TO ha-rule.ts IS A CYCLE ON PAPER ONLY. It is type-only, so it is
 *   erased before anything runs, and `HaRuleProps` stays public in the file declaring the resource.
 */
import type { HaRuleProps } from './ha-rule.ts';
import { csv } from './values.ts';

/**
 * A `<node>[:<pri>]` list, spelled the way PVE gives it back.
 *
 * ⛔ THIS IS NOT `csv`, AND THE DIFFERENCE IS A FOREVER-DIFF. MEASURED by reading
 *   `/usr/share/perl5/PVE/HA/Rules/NodeAffinity.pm` on node-b (2026-09-13): `decode_plugin_value`
 *   turns the list into a HASH keyed by node name, and `encode_plugin_value` rebuilds it with
 *   `for my $node (sort keys %$value)` — sorted by NODE NAME, never by the token — emitting the
 *   bare name whenever the priority is falsy, because `PVE::HA::Tools::parse_node_priority` reads
 *   a missing priority as 0. So a declared `node-c:1,node-b:0` is handed back as `node-b,node-c:1`: re-ordered AND
 *   re-spelled. Compare the raw strings and every plan reports an update, forever.
 *
 * ⚠️ SORTED BY NAME, NOT BY TOKEN, AND THE TWO GENUINELY DIVERGE. `csv` sorts whole tokens. Node
 *   names may contain `-` — `parse_node_priority`'s own regex is
 *   `[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?` — and `-` (0x2D) sorts before `:` (0x3A), so `node-b-a`
 *   and `node-b:5` come out in one order by token and the other by name. PVE sorts by the name, so
 *   this does too.
 *
 * ⚠️ LAST ENTRY WINS FOR A REPEATED NODE, because PVE's decode is a hash assignment and a hash
 *   keeps one value per key. A declaration saying `node-b:1,node-b:5` is stored as `node-b:5`; matching that
 *   is what a Map gives for free.
 */
export const nodeList = (value: readonly string[] | string | undefined) => {
  const ranked = new Map<string, number>();
  for (const entry of typeof value === 'string' ? value.split(',') : (value ?? [])) {
    const [node, priority] = entry.trim().split(':');
    if (node === undefined || node === '') continue;
    const rank = Number.parseInt(priority ?? '0', 10);
    ranked.set(node, Number.isNaN(rank) ? 0 : rank);
  }
  return [...ranked.keys()]
    .sort()
    .map((node) => {
      const rank = ranked.get(node) ?? 0;
      return rank === 0 ? node : `${node}:${String(rank)}`;
    })
    .join(',');
};

/**
 * PVE's own verdict on whether the rule can be satisfied, flattened to one reportable string.
 *
 * ⚠️ COMPUTED, NEVER DECLARED, AND NEVER COMPARED. `PVE::API2::HA::Rules` runs `check_feasibility`
 *   over the WHOLE rule set on every read and attaches whatever it finds to each rule as
 *   `errors => { <option> => "<message>, <message>" }`. It therefore changes when somebody else's
 *   rule changes, and none of it is a parameter any write accepts. It belongs in attributes so a
 *   plan can show that PVE considers this rule unsatisfiable, and nowhere near `matches`.
 */
export const problems = (value: unknown) =>
  typeof value === 'object' && value !== null
    ? Object.entries(value)
        .map(([option, message]) => `${option}: ${String(message)}`)
        .sort()
        .join('; ')
    : '';

/**
 * A comment as PVE will actually STORE it, which is not always the string it was handed.
 *
 * ⛔ PVE DECODES `%XX` OUT OF EVERY COMMENT ON THE WAY IN AND NEVER PUTS IT BACK. MEASURED:
 *   `PVE::SectionConfig::check_config` runs `decode_value` over each submitted field (line 1625 on
 *   this node), the base rule plugin's `decode_value` sends `comment` through
 *   `PVE::ParseUtils::decode_text` — `uri_unescape` then a utf8 decode — and `$get_api_ha_rule`
 *   hands the comment straight back WITHOUT re-encoding it (only `resources` and `nodes` are
 *   re-encoded there). So a declared `deploy%20window` is stored and returned as `deploy window`,
 *   and a `matches` comparing the declared string would report an update on every plan forever
 *   while every PUT wrote exactly what was already there.
 *
 * ★ SO THE COMPARISON MIRRORS THE DECODE RATHER THAN FIGHTING IT. Both sides then say what the
 *   cluster will really hold, which is the same move `nodeList` above makes for a re-sorted list.
 * ⚠️ GROUPS OF `%XX` ARE DECODED TOGETHER so a multi-byte utf8 sequence survives; a lone `%` or a
 *   malformed sequence is left alone, as `uri_unescape` leaves it. The one place this differs from
 *   Perl is a sequence that is valid percent-encoding but invalid utf8: Perl substitutes U+FFFD,
 *   this leaves the escape. Nothing in a comment should be reaching for that.
 */
export const commentText = (raw: string) =>
  raw.replace(/(?:%[0-9a-fA-F]{2})+/g, (escaped) => {
    try {
      return decodeURIComponent(escaped);
    } catch {
      return escaped;
    }
  });

/**
 * Every managed optional, per type: the value to send, or undefined for "clear it".
 *
 * ⛔ `disable=0` DOES NOT CLEAR A DISABLED RULE, AND THAT IS THE WORST TRAP IN THIS FAMILY.
 *   MEASURED in `/usr/share/perl5/PVE/API2/HA/Rules.pm`: both `create_rule` and `update_rule` run
 *   `delete $param->{disable} if !$param->{disable};` BEFORE the plugin sees the form. A PUT
 *   carrying `disable=0` is therefore a PUT carrying nothing — PVE answers 200, the rule stays
 *   disabled, `matches` reports an update on the next plan, and the loop never settles. The only
 *   way back on is `delete=disable`, which is why `disable` is in this table rather than in
 *   `required` below.
 *
 * ⛔ AND THE BRANCHES CANNOT BE ONE SHARED MAP. `PVE::SectionConfig::delete_from_config` dies
 *   `no such option '<k>'` for an option the plugin does not declare and `unable to delete
 *   required option '<k>'` for one it requires — so `delete=strict` against a resource-affinity
 *   rule is a hard failure, and `delete=nodes` or `delete=resources` would be one against either.
 *   Only `comment`, `disable` and (node-affinity only) `strict` are clearable at all.
 *
 * ⚠️ AN EMPTY `comment` IS A CLEARED ONE. PVE stores whatever string it is given, so writing `''`
 *   would leave the option present and empty rather than absent; `matches` reads both as `''`, but
 *   only the delete actually removes the line.
 */
export const optional = (props: HaRuleProps): Record<string, string | undefined> => ({
  comment: props.comment === undefined || props.comment === '' ? undefined : props.comment,
  disable: props.disable === true ? '1' : undefined,
  ...(props.type === 'node-affinity' ? { strict: props.strict === true ? '1' : undefined } : {}),
});

/**
 * The fields sent on EVERY write, create and update alike.
 *
 * ⛔ `type` GOES OUT ON THE UPDATE TOO, AND LEAVING IT OFF BREAKS EVERY PUT. It reads like a
 *   create-only discriminant — the handler certainly treats it as one, taking the plugin from the
 *   STORED rule — but the PUT is still validated against a `oneOf` keyed on it. MEASURED in
 *   `PVE::JSONSchema::check_one_of` on this node: when the type property is absent the validator
 *   marks EVERY other key unknown and, unless the whole `oneOf` is itself optional, errors on the
 *   type property; its own comment says "Its type property is otherwise never optional", and
 *   `SectionConfig::updateSchema` builds that `oneOf` through `combine_schemas` without an
 *   `optional` flag. So an update that omitted it would fail parameter verification with a pile of
 *   "unexpected property" errors pointing at the fields it did send. It is safe to send because a
 *   rule of the other type is reported ABSENT by `attributes` and never reaches a PUT.
 *
 * ⚠️ `affinity` IS SENT UNCONDITIONALLY FOR BOTH TYPES. PVE requires it on a resource-affinity
 *   create and defaults it to `positive` on a node-affinity one; sending it either way means the
 *   read-back matches on the first plan after the create rather than relying on PVE materialising
 *   its own default into the file.
 *
 * ⚠️ THE LISTS GO OUT IN THEIR NORMALISED FORM, which is not required but is free: PVE re-sorts
 *   them anyway, so writing what it will hand back keeps the config file readable next to the
 *   declaration that produced it.
 *
 * ⚠️ NO `digest`. PVE accepts one on PUT as an optimistic lock, but the only digest this provider
 *   could send is the one from its own read moments earlier — and it is a digest of the WHOLE
 *   rules file, so any unrelated rule written in between would turn a correct update into a
 *   spurious failure. The factory's read-back guard is the check that stays.
 */
const required = (props: HaRuleProps): Record<string, string> => ({
  affinity: props.affinity,
  resources: csv(props.resources),
  type: props.type,
  ...(props.type === 'node-affinity' ? { nodes: nodeList(props.nodes) } : {}),
});

export const body = (props: HaRuleProps) => {
  const fields = required(props);
  for (const [option, value] of Object.entries(optional(props))) {
    if (value !== undefined) fields[option] = value;
  }
  return fields;
};

/**
 * The options an update must explicitly remove.
 *
 * ⛔ A PUT THAT OMITS A FIELD DOES NOT CLEAR IT — `update_rule` merges the form into the stored
 *   rule (`$rule->{$_} = $opts->{$_} for keys $opts->%*`) — so a managed optional needs a matching
 *   `delete=` the moment its prop goes away. Both halves come off the one table above, which makes
 *   "managed but not clearable" impossible to write here.
 * ⚠️ NEVER BOTH AT ONCE: `delete_from_config` dies `cannot set and delete property '<k>' at the
 *   same time!`. The table answers a value or `undefined`, never both, so the two lists are
 *   disjoint by construction.
 * ⚠️ THE CREATE FORM CANNOT USE THIS. `POST /cluster/ha/rules` has no `delete` parameter at all
 *   (MEASURED from the cluster's own schema), and it needs none: an omitted optional on a brand
 *   new rule is simply absent.
 */
export const clearList = (props: HaRuleProps) =>
  Object.entries(optional(props))
    .filter(([, value]) => value === undefined)
    .map(([option]) => option);
