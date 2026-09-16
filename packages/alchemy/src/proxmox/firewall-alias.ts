/**
 * `Proxmox.FirewallAlias` — a named network the cluster firewall can be written in terms of.
 *
 * ★ WHY THIS FAMILY AND NOT FIREWALL RULES, WHICH IS THE ONE EVERYONE REACHES FOR FIRST. A rule is
 *   addressed BY POSITION — `/cluster/firewall/rules/{pos}` — so inserting a rule renumbers every
 *   rule below it. A position-keyed resource therefore RETARGETS ITSELF at somebody else's rule the
 *   moment anything is inserted above it, and it does so while the plan looks clean: the path still
 *   resolves, the read still succeeds, the diff is simply computed against the wrong object.
 *   Aliases, ipsets and security groups are the firewall objects with STABLE IDENTITY — a name, not
 *   an index — and they are the ones worth declaring. Rules belong in this package only once
 *   somebody models the whole ordered list as ONE resource, which is a different shape from
 *   `PveSpec` and should look different.
 *
 * ★ AND THE ALIAS IS THE PIECE THAT EARNS THE MOST BY BEING DECLARED. `10.1.0.0/16` spelled into
 *   nine rules is nine places to edit and one to forget; `HomeLan` spelled into nine rules is one
 *   place, resolved by PVE at compile time. The alias is the object that has to be right.
 *
 * ⛔ PVE REWRITES THE CIDR ON READ, AND THAT IS THE FOREVER-DIFF THIS RESOURCE IS SHAPED AROUND.
 *   A declared `10.1.1.5/32` reads back as `10.1.1.5`. `cidr()` in `firewall-alias-form.ts` applies
 *   exactly the cluster's own transformation to BOTH sides and carries the measurements; read that
 *   comment before touching either side of `matches` below.
 *
 * ⛔ `ipversion` IS RETURNED BY THE READ AND REFUSED BY EVERY WRITE. `parse_alias` derives it from
 *   the address and `read_alias` hands the parsed entry straight back, while POST and PUT declare
 *   `additionalProperties: 0` with no such parameter — sending it is a 400, not an ignored hint. It
 *   is REPORTED as an attribute so a plan can say whether an alias is v4 or v6, and kept OUT of
 *   `matches`, exactly like `pool.members` and `user.tokens`.
 *
 * ⚠️ `digest` NEVER REACHES THIS PROVIDER, which is a better answer than keeping it out of
 *   `matches`. The LIST read runs its entries through `copy_list_with_digest` and stamps one — and
 *   it changes whenever ANYTHING else in the firewall config changes, so a resource that stored it
 *   would diff on a rule somebody else edited. The SINGLE-OBJECT read this resource uses returns
 *   `$aliases->{$name}` raw, with no digest in it at all. None is sent on write either:
 *   `PVE::Tools::assert_if_modified` skips the comparison when either side is undef, and the API
 *   handler already holds `lock_clusterfw_conf(10, ...)` for the whole read-modify-write. So
 *   declining optimistic locking buys last-writer-wins between two concurrent editors, not a torn
 *   file — and the alternative, storing a cluster-wide digest per alias, buys a permanent diff.
 *
 * ⚠️ THE NAME IS CASE-FOLDED FOR IDENTITY AND PRESERVED FOR DISPLAY, which reads as a bug until you
 *   see both halves. The config is keyed `$aliases->{lc($data->{name})}` while the entry stores the
 *   name as written, and the item GET lowers its path segment too — so `homelan` and `HomeLan` are
 *   ONE alias, reachable by either spelling. `name` is therefore reported from the live config and
 *   kept OUT of `matches`: rewriting an alias to change its capitalisation is a cosmetic write to
 *   the file every node recompiles its firewall from.
 *   ⛔ AND TWO DECLARATIONS DIFFERING ONLY IN CASE ARE THE SAME OBJECT, which is the `acl.ts`
 *     hazard again. Alchemy sees two resource ids, the cluster sees one alias, and deleting either
 *     takes it away from both.
 *
 * ⚠️ A RENAME IS MODELLED AS A REPLACE, NOT AS AN UPDATE, AND THE REJECTED OPTION WAS REAL. PVE's
 *   PUT does take a `rename` parameter and Alchemy's `reconcile` does receive `olds`, so an
 *   in-place rename was available. It was rejected because using it means hand-writing `reconcile`
 *   as well as `diff` and branching on four states — old present or absent, new present or absent —
 *   each branch a fresh way to write the wrong object, and all of it to buy only the gap between
 *   the create and the delete. What a rename must NOT be is silent, which is what the factory alone
 *   would make it: the read at the NEW path answers absent, `diff` says update, reconcile POSTs a
 *   SECOND alias, and the old one stays in `cluster.fw` with its old CIDR — still resolving in
 *   every rule that names it, and invisible to every later plan. `diff` below says `replace`.
 *   ⚠️ CREATE-FIRST, as Alchemy defaults and as `acl.ts` argues: the new alias exists before the
 *     old one goes, so a rules change can be sequenced between the two generations.
 *
 * ⚠️ PRIVILEGES, AND FOR ONCE NOTHING NEEDS WIDENING. MEASURED 2026-09-13 from the cluster's own
 *   schema and its live ACL: the item GET checks `["perm","/",["Sys.Audit"]]`, POST/PUT/DELETE
 *   check `["perm","/",["Sys.Modify"]]`, `hf-read@pve` holds `PVEAuditor` at `/` with propagate and
 *   `hf-provision@pve` holds `LXCProvisioner` at `/` with propagate. Both privileges are already
 *   held, so `readRole` stays the default `read` lane — unlike storage/sdn-zone/sdn-vnet, whose
 *   ITEM reads are gated on an allocate privilege the auditor cannot have.
 *   ⚠️ `Sys.Modify` ON `/` IS STILL A BIG HAMMER — it is the same grant `metric-server.ts` warns
 *     about, and there is no `/firewall` object to scope a narrower role to.
 *
 * ⚠️ DELETION IS FULLY IMPLEMENTED AND THE DEFAULT POLICY IS DELIBERATELY NOT `retain`. The ★ in
 *   `resource.ts` reserves `retain` for objects whose CONTENTS cannot be rebuilt from a line of
 *   TypeScript; an alias is a name, a CIDR and a comment, all three of them in the declaration, so
 *   recreating one is exact and free. The real hazard is referential — PVE checks nothing before
 *   removing an alias, and a rule naming a removed one fails to compile — and `retain` would not
 *   fix that, it would only leave an undeclared alias on the cluster forever. Sequence the rules,
 *   or pipe `RemovalPolicy.retain()` at the declaration site where the reason is visible.
 *
 * ⚠️ `local_network` IS THE ONE ALIAS NAME WITH CLUSTER-WIDE MEANING. `compile_ipsets` reads
 *   `aliases->{local_network}` to decide what the `management` ipset covers, and SYNTHESISES one
 *   from the node's own subnet when it is missing — in memory, never written back to the file.
 *   Declaring it is stable, because PVE leaves a present one alone. DELETING it hands that decision
 *   silently back to autodetection, which is drift no plan will ever show.
 *
 * ⚠️ NO SECRET LIVES IN THIS FAMILY, so nothing here has to be typed `never` to keep it out of
 *   Alchemy's unencrypted state the way `metric-server.ts` does with its `token`. A name, a CIDR and
 *   a free-text comment are the whole object, and all three are the declaration's own values read
 *   back — not a credential held by the cluster.
 *
 * ⚠️ ACCEPTANCE, STATED HONESTLY: `GET /cluster/firewall/aliases` ANSWERS `[]` ON THIS CLUSTER and
 *   the cluster firewall is disabled, so there was no live alias to declare and NO create/plan/noop
 *   round trip was run. What is measured is the published schema, the API module's Perl, and the
 *   cluster's own `parse_alias` exercised on sample lines. Whoever declares the first alias should
 *   confirm the SECOND plan says noop before trusting this file.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { body, cidr, comment, fold } from './firewall-alias-form.ts';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { int, text } from './values.ts';

export interface FirewallAliasProps extends WithTarget {
  /**
   * PVE's `pve-fw-alias`: a letter, then at least one more of letter/digit/`-`/`_`, to 64 chars.
   * ⚠️ IDENTITY, CASE-INSENSITIVELY — see the ⚠️ on folding in the header. A two-character minimum
   *   is real: a one-letter name is refused by the pattern, not silently accepted.
   */
  name: string;
  /**
   * An IP or a network, e.g. `10.1.0.0/16`, `10.1.1.5`, `2001:db8::/32`.
   * ⚠️ A `/32` (or `/128`) SUFFIX IS DROPPED BY PVE AND BY `cidr()` ALIKE, so declaring one is
   *   harmless — it simply is not what comes back. Anything `parse_ip_or_cidr` refuses is a 400.
   */
  cidr: string;
  /**
   * Free text, stored as a trailing `#` comment on the alias's line in `cluster.fw`.
   * ⚠️ TRIMMED, AND A LINE FEED IS REFUSED. A comment of exactly `0` cannot be stored at all — the
   *   ⛔ in `firewall-alias-form.ts` measures why, and why declaring one plans as noop.
   */
  comment?: string;
}

export interface FirewallAliasAttributes {
  /** The spelling held in `cluster.fw`, which need not be the declared one. Never compared. */
  name: string;
  /** Normalised the way PVE normalises it, so it is comparable with a declaration. */
  cidr: string;
  comment: string;
  /**
   * 4 or 6, derived by PVE from the address. Reported so a plan can show which stack an alias
   * covers; never compared, because no write accepts it.
   */
  ipversion: number;
}

export interface ProxmoxFirewallAlias extends Resource<
  'Proxmox.FirewallAlias',
  FirewallAliasProps,
  FirewallAliasAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxFirewallAlias = Resource<ProxmoxFirewallAlias>('Proxmox.FirewallAlias');

const handlers = pveHandlers<FirewallAliasProps, FirewallAliasAttributes>({
  /**
   * ⚠️ AN ENTRY WITH NO CIDR IS NOT AN ALIAS. `read_alias` raises for a name it does not hold, so
   *   absence normally arrives as a failed call the factory folds into `undefined`; this guard
   *   covers the other shape — a 200 carrying something that is not an alias — rather than
   *   recording state for an object with an empty address. The next reconcile then POSTs and PVE
   *   answers "alias already exists", which is loud and points at the read.
   */
  attributes: (live, props) => {
    const address = cidr(live['cidr']);
    return address === ''
      ? undefined
      : {
          cidr: address,
          comment: comment(live['comment']),
          ipversion: int(live['ipversion'], 0),
          /** ⚠️ FROM THE CLUSTER, falling back to props: the stored spelling is the interesting one. */
          name: text(live['name'], props.name),
        };
  },
  collection: () => 'cluster/firewall/aliases',
  createForm: (props) => ({ ...body(props), name: props.name }),
  /**
   * ⚠️ EXACTLY THE TWO FIELDS A PUT CAN PUT BACK, both sides through the same normalisers. `name`
   *   is identity and case-only drift (see the header); `ipversion` is derived and unwritable.
   *   Comparing either would report an update that no update can settle.
   */
  matches: (attributes, props) =>
    attributes.cidr === cidr(props.cidr) && attributes.comment === comment(props.comment),
  /**
   * ⚠️ UNESCAPED ON PURPOSE: `pve-fw-alias` admits only `[A-Za-z][A-Za-z0-9\-\_]+`, so there is no
   *   character here that a URL would need to encode, and PVE lowercases the segment on arrival.
   */
  path: (props) => `cluster/firewall/aliases/${props.name}`,
  updateForm: body,
});

/**
 * ⛔ ONE HANDLER IS OVERRIDDEN AND THE REST COME FROM THE FACTORY, for the reason `acl.ts` spells
 *   out at length: the factory answers `replace` only for an object with no update path, and this
 *   one has a PUT. Left to delegate, a changed `name` would read absent at the new path, plan as an
 *   update, and quietly leave the old alias behind. Everything else — the empty `list`, the read,
 *   the read-back-guarded reconcile, the delete — is the factory's, unchanged.
 */
export const ProxmoxFirewallAliasProvider = () =>
  Provider.effect(
    ProxmoxFirewallAlias,
    Effect.succeed(
      ProxmoxFirewallAlias.Provider.of({
        ...handlers,
        diff: Effect.fn(function* ({ news, output }) {
          // ⚠️ `isResolved` FIRST: at plan time `news.name` can still be an unresolved Output, and
          //   folding a placeholder would report a replace nobody asked for — the worst possible
          //   false positive on this family, since a replace here DELETES an alias.
          if (output !== undefined && isResolved(news) && fold(news.name) !== fold(output.name)) {
            return { action: 'replace' } as const;
          }
          return yield* handlers.diff({ news, output });
        }),
      }),
    ),
  );
