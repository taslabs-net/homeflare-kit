/**
 * The write SCOPE of `Unifi.Network`: the one intended consumer is a single VLAN's
 * `ipv6Configuration`, so everything else a whole-object PUT could reach is refused BEFORE any
 * request, with a typed error that carries field names only.
 *
 * ⛔ SETTABLE ALLOWLIST. A key in `patch.set` is written into the PUT body, so only
 *   `ipv6Configuration` may be set: `enabled`, `internetAccessEnabled`, `ipv4Configuration`,
 *   `dhcpGuarding` and every other declared key are refused with `UnifiFieldNotSettable` (a touched
 *   immutable key gets `UnifiImmutableFieldChanged` first). Widening it is a kit change.
 * ⛔ REMOVABLE ALLOWLIST. A key in `patch.unset` is deleted from the PUT body, and the controller
 *   reads an omitted `dhcpGuarding`/`ipv4Configuration`/`ipv6Configuration` as "off". Dropping a
 *   declaration key therefore must not silently turn a live block off: only `ipv6Configuration`
 *   (the block this write path exists for, and the revert target) may be removed. A required key
 *   (`name`, `vlanId`, …) removed from a declaration would fail the SDK schema or send a body the
 *   controller rejects, so it is refused here with the same error.
 * ⛔ `default: true` IS THE MANAGEMENT LAN. Writing it can cut the admin off the console.
 * ⛔ `zoneId`/`vlanId`/`management`/`deviceId` decide where the network lives and what serves it;
 *   a patch (set OR unset) touching one is refused. Non-USER `metadata.origin` is deliberately NOT
 *   handled yet: no rule exists for it.
 */
import type * as networks from '@distilled.cloud/unifi-network/networks';
import * as Effect from 'effect/Effect';
import type { NetworkProps } from './network-form.ts';
import {
  UnifiFieldNotRemovable,
  UnifiFieldNotSettable,
  UnifiImmutableFieldChanged,
  UnifiManagementNetworkRefused,
} from './policy.ts';
import type { Patch } from './update-reconcile.ts';

export const SETTABLE_KEYS: ReadonlyArray<keyof NetworkProps> = ['ipv6Configuration'];
export const REMOVABLE_KEYS: ReadonlyArray<keyof NetworkProps> = ['ipv6Configuration'];
export const IMMUTABLE_KEYS: ReadonlyArray<keyof NetworkProps> = [
  'zoneId',
  'vlanId',
  'management',
  'deviceId',
];

export type ScopeError =
  | UnifiFieldNotRemovable
  | UnifiFieldNotSettable
  | UnifiImmutableFieldChanged
  | UnifiManagementNetworkRefused;

const isIn = (list: ReadonlyArray<string>) => (key: string) => list.includes(key);

export const checkNetworkWriteScope = (
  live: networks.NetworkDetails,
  patch: Patch<NetworkProps>,
  props: NetworkProps,
): Effect.Effect<void, ScopeError> => {
  const type = 'Unifi.Network';
  const identity = `sites/${props.siteId}/networks/${props.networkId}`;
  if (live.default === true) {
    return Effect.fail(new UnifiManagementNetworkRefused({ type, identity }));
  }
  const touched = [...Object.keys(patch.set), ...patch.unset.map(String)];
  const immutable = touched.filter(isIn(IMMUTABLE_KEYS as ReadonlyArray<string>));
  if (immutable.length > 0) {
    return Effect.fail(new UnifiImmutableFieldChanged({ type, identity, fields: immutable }));
  }
  const removable = isIn(REMOVABLE_KEYS as ReadonlyArray<string>);
  const notRemovable = patch.unset.map(String).filter((k) => !removable(k));
  if (notRemovable.length > 0) {
    return Effect.fail(new UnifiFieldNotRemovable({ type, identity, fields: notRemovable }));
  }
  const settable = isIn(SETTABLE_KEYS as ReadonlyArray<string>);
  const notSettable = Object.keys(patch.set).filter((k) => !settable(k));
  if (notSettable.length > 0) {
    return Effect.fail(new UnifiFieldNotSettable({ type, identity, fields: notSettable }));
  }
  return Effect.void;
};
