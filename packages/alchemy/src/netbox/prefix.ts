/**
 * `Netbox.Prefix` — one IP prefix and the decision recorded against it.
 *
 * ★ WHY THIS OBJECT CLASS IS THE FIRST ONE, AND NOT `Device`, `VLAN` OR `Site`. Three reasons,
 *   each measurable rather than aesthetic:
 *
 *   1. **It is the only interesting NetBox object with no foreign-key prerequisite.** MEASURED in
 *      the 4.7.0 schema: `WritablePrefixRequest.required` is exactly `["prefix"]`. A `VLAN` needs
 *      `vid` AND `name` and belongs to a group or site; a `Device` needs a role, a type, a site
 *      and usually a manufacturer — four more Resources before the first one can be declared.
 *      A scaffold that cannot declare anything until five families exist proves nothing.
 *   2. **It is what the estate's NetBox is FOR.** The house's own IPAM agent describes its job as
 *      reconciling "what the network IS against what NetBox says it was DECIDED to be". A prefix
 *      is the atom of that decision. The estate has prefixes whose status is currently recorded
 *      only in an SSH config comment and a retirement doc — a management VLAN, a Thunderbolt
 *      point-to-point, and three ranges that are retired and still resolve in people's heads.
 *   3. **`status: 'deprecated'` makes retirement declarable.** That is the move this unlocks:
 *      a retired range stops being folklore and becomes a line in a stack file with a reviewable
 *      diff. No other NetBox class turns an estate decision into one field this cleanly.
 *
 * ⚠️ ADOPT-FRIENDLY BY CONSTRUCTION. `locate` filters on the exact `prefix`; `identifies` then
 *   picks the declared VRF, because NetBox allows the same CIDR in two VRFs and in the global
 *   table. An instance that already holds `10.0.0.0/24` is BOUND, never duplicated — and ⛔ an
 *   adopt never clears prose it did not declare (prefix-form.ts).
 *
 * ⛔ THIS RESOURCE DOES NOT REMOVE PREFIXES IT DOES NOT DECLARE, and `defaultRemovalPolicy` is
 *   `retain` (resource.ts). Deleting a prefix in NetBox reparents its children and detaches its
 *   IP assignments; the record of why it existed survives only in the change log.
 *
 * ⛔ NO CREDENTIAL IS A PROP. `NETBOX_URL` and `NETBOX_TOKEN` are read from the environment at
 *   call time, through `@distilled.cloud/netbox`'s `CredentialsFromEnv` (resource.ts) — the house
 *   convention, and the only shape that keeps a token out of Alchemy state. Unchanged by this
 *   migration off `client.ts`'s hand-rolled `HttpClient` calls onto distilled's typed operations.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as ipam from '@distilled.cloud/netbox/ipam';
import * as Effect from 'effect/Effect';
import { prefixBody, prefixMatches } from './prefix-form.ts';
import {
  LOCATE_PAGE,
  type NetboxRequirements,
  type NetboxSpec,
  locateOne,
  netboxHandlers,
} from './resource.ts';
import { choice, fk, text } from './values.ts';

/**
 * ⚠️ THE FOUR VALUES ARE THE VENDOR'S, NOT OURS — copied from the generated table, which is
 *   generated from NetBox's own enum. The table is what ENFORCES them; this type is what makes
 *   the mistake visible in an editor.
 */
export type PrefixStatus = 'container' | 'active' | 'reserved' | 'deprecated';

export interface PrefixProps {
  /** CIDR, exactly as NetBox stores it — `10.0.0.0/24`. The stable key for locate. */
  prefix: string;
  /**
   * VRF id, or omitted for the global table.
   *
   * ⛔ PART OF THE IDENTITY, NOT A SETTING. NetBox's uniqueness on a prefix is per-VRF, so a
   *   locate that ignored it could match two rows — which `soleMatch` refuses rather than
   *   guessing between.
   */
  vrf?: number;
  status?: PrefixStatus;
  /** ⚠️ `maxLength: 200` in the schema; the generated table enforces it at plan time. */
  description?: string;
  /** Free text. ⚠️ NetBox states no length limit, so nothing here checks one. */
  comments?: string;
  tenant?: number;
  vlan?: number;
  /** All addresses inside are usable. */
  isPool?: boolean;
  markUtilized?: boolean;
}

export interface PrefixAttributes {
  prefixId: number;
  prefix: string;
  status: string;
  description: string;
  comments: string;
  vrf: number | undefined;
  tenant: number | undefined;
  vlan: number | undefined;
  isPool: boolean;
  markUtilized: boolean;
}

export interface NetboxPrefix extends Resource<
  'Netbox.Prefix',
  PrefixProps,
  PrefixAttributes,
  never,
  NetboxRequirements
> {}

export const NetboxPrefix = Resource<NetboxPrefix>('Netbox.Prefix', {
  defaultRemovalPolicy: 'retain',
});

const attributesOf = (live: ipam.Prefix, props: PrefixProps): PrefixAttributes => ({
  comments: text(live.comments),
  description: text(live.description),
  isPool: live.is_pool === true,
  markUtilized: live.mark_utilized === true,
  prefix: live.prefix || props.prefix,
  prefixId: live.id,
  status: choice(live.status),
  tenant: fk(live.tenant),
  vlan: fk(live.vlan),
  vrf: fk(live.vrf),
});

/**
 * ★ EXPORTED for direct testing with an explicit fake `Credentials` layer — see
 *   `fake-netbox.ts`/`prefix.test.ts`, the same seam `../forgejo/repository.ts` uses.
 */
export const spec: NetboxSpec<
  PrefixProps,
  ipam.Prefix,
  PrefixAttributes,
  | ipam.CreateIpamPrefixError
  | ipam.ListIpamPrefixesError
  | ipam.UpdateIpamPrefixesPartialError
  | ipam.IpamPrefixesDestroyError
> = {
  attributes: attributesOf,
  create: (_props, body) =>
    ipam.createIpamPrefix({ body: body as unknown as ipam.WritablePrefixRequest }),
  createBody: prefixBody,
  destroy: (_props, live) => ipam.ipamPrefixesDestroy({ id: live.id }),
  describe: (props) => `ipam/prefixes ${props.prefix}`,
  endpoint: {
    create: 'netbox:POST /api/ipam/prefixes/',
    update: 'netbox:PATCH /api/ipam/prefixes/{id}/',
  },
  /**
   * 🔴 THE VRF IS **NOT** IN THIS SERVER-SIDE FILTER, AND THE REASON IS A GUESS THAT WAS CAUGHT.
   *   An earlier version filtered `vrf_id=null` for the global table — NetBox does define
   *   `FILTERS_NULL_CHOICE_VALUE = 'null'` and does honour it on filters that opt in. ⛔ MEASURED
   *   IN THE VENDOR'S OWN SOURCE at v4.7.0: `PrefixFilterSet.vrf_id` is a plain
   *   `django_filters.ModelMultipleChoiceFilter` with NO `null_value`, so `'null'` is validated
   *   against the VRF queryset, fails, and NetBox answers 400 under strict filtering. The
   *   sentinel is real but it is opt-in per filter, and this one did not opt in.
   * ★ SO THE DISCRIMINATOR STAYS IN THIS PROCESS, VIA `locateOne`'s `identifies` — one extra page
   *   of candidates, no vendor semantics guessed. `listIpamPrefixes` never declares `NotFound`
   *   (a list call 200s with an empty page, it does not 404), so there is no status to fold here.
   */
  fetchLive: (props) =>
    locateOne(
      ipam.listIpamPrefixes({ limit: LOCATE_PAGE, prefix: [props.prefix] }),
      `ipam/prefixes ${props.prefix}`,
      (row) => fk(row.vrf) === props.vrf,
    ),
  matches: prefixMatches,
  update: {
    body: prefixBody,
    call: (_props, live, body) =>
      ipam.updateIpamPrefixesPartial({
        ...(body as unknown as Omit<ipam.UpdateIpamPrefixesPartialRequest, 'id'>),
        id: live.id,
      }),
  },
};

export const handlers = netboxHandlers(spec);

export const NetboxPrefixProvider = () =>
  Provider.effect(NetboxPrefix, Effect.succeed(NetboxPrefix.Provider.of(handlers)));
