/**
 * `Opnsense.Firewall.Group` — a read-only declaration of one `firewall/group` item (an
 * "Interface Group", not a permission group) on the edge. READ-ONLY BY DESIGN — see policy.ts's
 * header. `reconcile`/`delete` always refuse. Mirrors alias.ts exactly; see that file's header
 * for why `get()` (whole model) is the read source uniformly across this family rather than the
 * now-correct `getGroup` per-item operation (OPNSENSE-1 fixed `GetGroupRequest`'s missing `uuid`,
 * but switching to it is a separate, later PR). `members` decodes as an option map, not a comma
 * string — see `group-form.ts`'s `attributesOf` (OPNSENSE-2).
 */
import { adopt } from 'alchemy/AdoptPolicy';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Group from '@distilled.cloud/opnsense/firewall_group';
import type { OpnsenseOpError } from '@distilled.cloud/opnsense/Protocol';
import * as Effect from 'effect/Effect';
import { attributesOf, matches } from './group-form.ts';
import type { OpnsenseRequirements, OpnsenseSpec } from './resource.ts';
import { opnsenseHandlers } from './resource.ts';

export interface GroupProps {
  readonly uuid: string;
  /** OPNsense's own `GroupNameField` — the interface group's name. */
  readonly ifname: string;
  /** Member interface names (`lan`, `opt1`, …), not their descriptions. */
  readonly members: readonly string[];
  /** OPNsense's own "no group" flag — excludes it from certain interface pickers. Default false. */
  readonly nogroup?: boolean;
  /** UI list position, `0`..`9999`. Carries no evaluation-order meaning for this object type. */
  readonly sequence?: number;
  readonly description?: string;
}

export interface GroupAttributes {
  readonly uuid: string;
  readonly ifname: string;
  readonly members: readonly string[];
  readonly nogroup: boolean;
  readonly sequence: number;
  readonly description: string;
}

export interface OpnsenseFirewallGroup extends Resource<
  'Opnsense.Firewall.Group',
  GroupProps,
  GroupAttributes,
  never,
  OpnsenseRequirements
> {}

export const OpnsenseFirewallGroup = Resource<OpnsenseFirewallGroup>('Opnsense.Firewall.Group', {
  defaultRemovalPolicy: 'retain',
});

export const isOpnsenseFirewallGroup = (value: unknown): value is OpnsenseFirewallGroup =>
  typeof value === 'object' &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Opnsense.Firewall.Group';

export const spec: OpnsenseSpec<
  GroupProps,
  Group.ModelIfgroupentryReadItem,
  GroupAttributes,
  OpnsenseOpError
> = {
  attributes: attributesOf,
  fetchLive: (props) =>
    Group.get({}).pipe(Effect.map((res) => res.group?.ifgroupentry?.[props.uuid])),
  matches,
  resourceType: 'Opnsense.Firewall.Group',
};

/** The pure declaration renderer — see alias.ts's `propsFromLive` for the full contract note. */
export const propsFromLive = attributesOf;

export const handlers = opnsenseHandlers(spec);

export const OpnsenseFirewallGroupProvider = () =>
  Provider.effect(
    OpnsenseFirewallGroup,
    Effect.succeed(OpnsenseFirewallGroup.Provider.of(handlers)),
  );

/** `firewallGroup('name', { uuid, ifname, members })` — `adopt(true)` piped by default (H5). */
export const firewallGroup = (id: string, props: GroupProps) =>
  OpnsenseFirewallGroup(id, props).pipe(adopt(true));
