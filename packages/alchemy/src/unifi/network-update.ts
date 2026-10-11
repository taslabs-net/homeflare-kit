/**
 * `Unifi.Network`'s one write: `updateNetwork`. THE ONLY FILE UNDER `src/unifi` ALLOWED TO NAME IT
 * (`write-op-reference.test.ts`'s `WRITE_OP_ALLOWLIST` pins that, and still refuses
 * `createNetwork`/`deleteNetwork` here).
 *
 * ⛔ THE WHOLE-OBJECT-PUT TRAP (packages/distilled-unifi-network/README.md). `PUT .../networks/{id}` disables
 *   `dhcpGuarding`/`ipv4Configuration`/`ipv6Configuration` outright when the body omits them. So
 *   the body is never `props`: it is the RAW live object (as `fetchLive` decoded it) minus the
 *   server fields (`SERVER_FIELDS`: `id`/`default`/`metadata`), plus ONLY the patch (HIGH-2). A
 *   hand edit on a field
 *   the declaration never touched rides through byte-for-byte; `update-reconcile.ts` has already
 *   refused any hand edit on a declared field.
 *
 * ★ WHY RAW LIVE, NOT THE ATTRIBUTES VIEW (LOW-6). `attributesOf` normalizes (sorted sets) and
 *   drops keys this kit does not model. Unknown keys must survive the round trip or the PUT would
 *   silently delete a setting the console added after the SDK was generated (F2). Measured by
 *   reading `@distilled.cloud/core` `protocol-http.ts`: `validateResponse` returns the ORIGINAL
 *   decoded value and `mapKeys` passes unknown keys through at every level, so top-level and
 *   nested unknown keys both survive; `network-update.test.ts` is the alarm if that ever changes.
 *
 * ★ WHY `unset` EXISTS (HIGH-1). Reverting a declaration (dropping `ipv6Configuration`) must plan
 *   and execute a real update back to the pre-image. A key in `patch.unset` is DELETED from the
 *   body, which is exactly "absent = off" for the optional blocks above.
 *
 * ⛔ NO-OP GUARD. If the merged body equals live (ignoring the ids), the PUT would change nothing;
 *   `UnifiUpdateWouldBeNoop` refuses so a normalizer gap can never become a re-PUT loop.
 *
 * ⛔ NO RETRY ON THE PUT (red team round 1, reversing the earlier Q7 decision). The SDK's default
 *   policy would replay a write whose first attempt may already have landed (a dropped response
 *   during a reprovision); a replay then runs against a controller state this reconcile never
 *   read. One attempt, and a failure surfaces for the operator. Reads keep the default policy.
 *
 * ⛔ SCOPE FIRST (`network-scope.ts`): the management LAN, immutable fields and non-removable keys
 *   are refused before the body is even built, so none of them can reach the wire.
 */
import * as networks from '@distilled.cloud/unifi-network/networks';
import * as Retry from '@distilled.cloud/unifi-network/Retry';
import { deepEqual } from 'alchemy/Diff';
import * as Effect from 'effect/Effect';
import { type NetworkProps } from './network-form.ts';
import { checkNetworkWriteScope } from './network-scope.ts';
import { UnifiUpdateWouldBeNoop } from './policy.ts';
import type { Patch } from './update-reconcile.ts';

export const SERVER_FIELDS = ['id', 'default', 'metadata'] as const;

/**
 * The live object minus `SERVER_FIELDS` — ONE list drives the strip. The destructure this
 * replaced hard-coded the same three names a second time, so a key added to the export was
 * silently NOT stripped (and a removed one still was): two lists that could drift apart. Own
 * enumerable string keys only, exactly what object-rest destructure copies; a decoded JSON body
 * has no symbol keys.
 */
const withoutServerFields = (live: networks.NetworkDetails): Record<string, unknown> => {
  const server = new Set<string>(SERVER_FIELDS);
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(live)) {
    if (!server.has(key)) rest[key] = value;
  }
  return rest;
};

export const mergeForUpdate = (
  live: networks.NetworkDetails,
  patch: Patch<NetworkProps>,
  props: NetworkProps,
): Effect.Effect<networks.UpdateNetworkRequest, UnifiUpdateWouldBeNoop> => {
  // Raw copy minus the server fields: unknown top-level keys stay in `rest` (F2).
  const rest = withoutServerFields(live);
  const body: Record<string, unknown> = { ...rest, ...patch.set };
  for (const key of patch.unset) delete body[key];
  if (deepEqual(body, rest, { stripNullish: true })) {
    return Effect.fail(
      new UnifiUpdateWouldBeNoop({
        type: 'Unifi.Network',
        identity: `sites/${props.siteId}/networks/${props.networkId}`,
      }),
    );
  }
  return Effect.succeed({
    ...body,
    siteId: props.siteId,
    networkId: live.id,
  } as networks.UpdateNetworkRequest);
};

export const writeNetwork = (
  live: networks.NetworkDetails,
  patch: Patch<NetworkProps>,
  props: NetworkProps,
) =>
  checkNetworkWriteScope(live, patch, props).pipe(
    Effect.andThen(mergeForUpdate(live, patch, props)),
    Effect.flatMap((body) => networks.updateNetwork(body).pipe(Retry.none)),
  );
