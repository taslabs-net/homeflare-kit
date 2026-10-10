/**
 * `Unifi.Network`'s one write: `updateNetwork`. THE ONLY FILE UNDER `src/unifi` ALLOWED TO NAME IT
 * (`write-op-reference.test.ts`'s `WRITE_OP_ALLOWLIST` pins that, and still refuses
 * `createNetwork`/`deleteNetwork` here).
 *
 * ⛔ THE WHOLE-OBJECT-PUT TRAP (`docs/unifi-api-notes.md`). `PUT .../networks/{id}` disables
 *   `dhcpGuarding`/`ipv4Configuration`/`ipv6Configuration` outright when the body omits them. So
 *   the body is never `props`: it is the RAW live object (as `fetchLive` decoded it) minus the
 *   server fields `id`/`default`/`metadata`, plus ONLY the patch (HIGH-2). A hand edit on a field
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
 * ★ RETRY: the SDK's default retry policy is KEPT (Q7). The body is the whole object, so a retried
 *   PUT is idempotent and a doubled reprovision is tolerable. `Retry.none` would turn a dropped
 *   response during reprovision into a false `apply-failed`.
 */
import * as networks from '@distilled.cloud/unifi-network/networks';
import { deepEqual } from 'alchemy/Diff';
import * as Effect from 'effect/Effect';
import { type NetworkProps } from './network-form.ts';
import { UnifiUpdateWouldBeNoop } from './policy.ts';
import type { Patch } from './update-reconcile.ts';

export const SERVER_FIELDS = ['id', 'default', 'metadata'] as const;

export const mergeForUpdate = (
  live: networks.NetworkDetails,
  patch: Patch<NetworkProps>,
  props: NetworkProps,
): Effect.Effect<networks.UpdateNetworkRequest, UnifiUpdateWouldBeNoop> => {
  // Raw destructure: unknown top-level keys stay in `rest` (F2).
  const { id, default: _default, metadata: _metadata, ...rest } = live;
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
    networkId: id,
  } as networks.UpdateNetworkRequest);
};

export const writeNetwork = (
  live: networks.NetworkDetails,
  patch: Patch<NetworkProps>,
  props: NetworkProps,
) => mergeForUpdate(live, patch, props).pipe(Effect.flatMap(networks.updateNetwork));
