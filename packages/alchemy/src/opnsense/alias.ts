/**
 * `Opnsense.Firewall.Alias` — a read-only declaration of one `firewall/alias` item on the edge.
 * READ-ONLY BY DESIGN — see policy.ts's header. `reconcile`/`delete` always refuse.
 *
 * ★ READ GOES THROUGH `get()`, NEVER `getItem`/`searchItem`. `get()` (`firewall_alias.ts#get`)
 *   returns the WHOLE model tree — `{ alias: { aliases: { alias: { <uuid>: ModelAliasReadItem,
 *   ... } } } }` — so finding one item by uuid is an object-key lookup, not a request the vendor
 *   could answer ambiguously. `Alias` has no per-item `getAlias` operation at all (`getItemAction`
 *   decorates its result — see the distilled clone's package README) — only `get` (whole model)
 *   and `searchAlias` (paginated, see below) exist, so this family's whole-model read is the only
 *   option here (unlike Category/Group, whose `getCategory`/`getGroup` per-item operations now
 *   exist correctly — OPNSENSE-1 — but this file still uses `get()` uniformly across the three
 *   resources; switching Category/Group to their per-item operation is a separate, later PR).
 *   `ModelAliasReadItem`'s list-shaped fields (`type`/`interface`/`proto`/`categories`) decode as
 *   option maps, not strings (OPNSENSE-2) — see `alias-form.ts`'s `attributesOf`.
 *
 * ⛔ NOT `searchAlias`. It is POST-shaped (a read, per OPNsense's own MVC convention — see the
 *   family's docs page) and paginated with no typed limit/offset the generated request schema
 *   exposes, so a large alias set could silently page-truncate through it. `get()` has neither
 *   problem: GET, and the WHOLE model in one call, no pagination to fall short of.
 *
 * ⚠️ `uuid` IS THE ONLY STABLE IDENTITY THIS FAMILY DECLARES BY. A name is close to stable
 *   (`AliasNameField` is unique) but is not what `get()`'s map is keyed on — obtain the live
 *   uuid once (a future import script does this from a live read, via `propsFromLive` below)
 *   and declare it from then on, the same "adoption is explicit, one identity at a time" posture
 *   `../proxmox/user.ts` and `../netbox/resource.ts` document for their own families.
 */
import { adopt } from 'alchemy/AdoptPolicy';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Alias from '@distilled.cloud/opnsense/firewall_alias';
import type { OpnsenseOpError } from '@distilled.cloud/opnsense/Protocol';
import * as Effect from 'effect/Effect';
import { attributesOf, matches } from './alias-form.ts';
import type { OpnsenseRequirements, OpnsenseSpec } from './resource.ts';
import { opnsenseHandlers } from './resource.ts';

export interface AliasProps {
  /** OPNsense-assigned uuid — see the file header on why this is the only identity to declare by. */
  readonly uuid: string;
  readonly name: string;
  /** e.g. `host`, `network`, `port`, `url`, `geoip`, `networkgroup` — OPNsense's own alias types. */
  readonly type: string;
  /** Default true, matching OPNsense's own `enabled=1`. */
  readonly enabled?: boolean;
  /** The alias's members — a host list, a CIDR, a URL, depending on `type`. */
  readonly content?: string;
  readonly interface?: string;
  /** `IPv4` or `IPv6`, for a `geoip`/`networkgroup` alias; comma-joined on the wire (wire.ts). */
  readonly proto?: string;
  readonly counters?: boolean;
  /** Minutes between refreshes, for a `url`/`urltable` alias. */
  readonly updatefreq?: number;
  readonly categories?: readonly string[];
  readonly description?: string;
}

export interface AliasAttributes {
  readonly uuid: string;
  readonly name: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly content: string;
  readonly interface: string;
  readonly proto: string;
  readonly counters: boolean;
  readonly updatefreq: number;
  readonly categories: readonly string[];
  readonly description: string;
}

export interface OpnsenseFirewallAlias extends Resource<
  'Opnsense.Firewall.Alias',
  AliasProps,
  AliasAttributes,
  never,
  OpnsenseRequirements
> {}

export const OpnsenseFirewallAlias = Resource<OpnsenseFirewallAlias>('Opnsense.Firewall.Alias', {
  // The edge's own config, not this stack's to reclaim — see policy.ts.
  defaultRemovalPolicy: 'retain',
});

export const isOpnsenseFirewallAlias = (value: unknown): value is OpnsenseFirewallAlias =>
  typeof value === 'object' &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Opnsense.Firewall.Alias';

/** Exported for direct testing against `fake-opnsense.ts` — the same seam `../discord/*.ts` uses. */
export const spec: OpnsenseSpec<
  AliasProps,
  Alias.ModelAliasReadItem,
  AliasAttributes,
  OpnsenseOpError
> = {
  attributes: attributesOf,
  fetchLive: (props) =>
    Alias.get({}).pipe(Effect.map((res) => res.alias?.aliases?.alias?.[props.uuid])),
  matches,
  resourceType: 'Opnsense.Firewall.Alias',
};

/**
 * The pure declaration renderer: given the uuid `get()`'s map key names and the `AliasItem`
 * decoded at that key, return the props a declaration needs so `firewallAlias.spec.matches`
 * reports noop against it. A later import script iterates `Object.entries(map)` and calls this
 * once per row to generate an `alchemy.run.ts` row — see `alias-form.test.ts`'s round-trip test.
 */
export const propsFromLive = attributesOf;

export const handlers = opnsenseHandlers(spec);

export const OpnsenseFirewallAliasProvider = () =>
  Provider.effect(
    OpnsenseFirewallAlias,
    Effect.succeed(OpnsenseFirewallAlias.Provider.of(handlers)),
  );

/** `firewallAlias('name-alias', { uuid, name, type })` — `adopt(true)` piped by default (H5), so
 * declaring a live alias's own uuid takes it over silently instead of failing `OwnedBySomeoneElse`. */
export const firewallAlias = (id: string, props: AliasProps) =>
  OpnsenseFirewallAlias(id, props).pipe(adopt(true));
