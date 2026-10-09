/**
 * The `cfd_tunnel` calls a Cloudflare Tunnel (the cloudflared kind) needs, and nothing else.
 *
 * ★ OVER `@distilled.cloud/cloudflare`, THE SDK ALCHEMY'S OWN CLOUDFLARE PROVIDERS USE, the same
 *   one mesh-node-api.ts calls. The operations are `createTunnelCloudflared` (POST
 *   `/accounts/{account_id}/cfd_tunnel`), `getTunnelCloudflared`, `patchTunnelCloudflared`,
 *   `deleteTunnelCloudflared` and the account-wide `listTunnels` (GET `/accounts/{id}/tunnels`,
 *   filtered to `cfd_tunnel`), all in distilled `1.0.0-rc.13` `src/services/zero_trust.ts`
 *   (read 2026-10-09).
 *
 * ⛔ NO FUNCTION IN THIS FILE CALLS `getTunnelCloudflaredToken`, AND `observe` COPIES NAMED FIELDS
 *   ONLY. Alchemy's own `Cloudflare.Tunnel.Tunnel` (beta.81, Tunnel/Tunnel.ts `reconcile`, `read`
 *   and `list`) fetches the token on every call and stores it as a `Redacted` attribute, which
 *   `encodeState` (State/StateEncoding.ts) writes into state as `{"__redacted__": "<token>"}`:
 *   plaintext, and the token runs the tunnel. This package never holds it, so there is nothing to
 *   leak. See cloudflared-tunnel-form.ts.
 * ⚠️ `createTunnelCloudflared` takes no `tunnelSecret` here either: the schema calls the field the
 *   password for a locally-managed tunnel and marks it optional (distilled rc.13 zero_trust.ts,
 *   `CreateTunnelCloudflaredRequest`); that Cloudflare generates one when it is omitted is
 *   UNVERIFIED, and a remotely managed tunnel needs no secret on our side.
 */
import * as zeroTrust from '@distilled.cloud/cloudflare/zero-trust';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';

/** A live tunnel as this package sees it. ⛔ There is no token or secret field, on purpose. */
export interface ObservedTunnel {
  readonly id: string;
  readonly name: string;
  /** `undefined` when the response omitted it; only an explicit `local` is refused (lifecycle). */
  readonly configSrc: 'cloudflare' | 'local' | undefined;
}

/** A refusal or failure, carrying the sentence an operator needs. Never a token. */
export class CloudflaredTunnelError extends Data.TaggedError('CloudflaredTunnelError')<{
  readonly message: string;
}> {}

type Raw = {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly configSrc?: string | null;
  readonly tunType?: string | null;
  readonly deletedAt?: string | null;
};

/**
 * ⚠️ A DELETED TUNNEL IS NOT A TUNNEL. Cloudflare keeps deleted tunnels (every response carries
 *   `deleted_at`), so a `GET` by id can answer for one; adopting that tombstone would PATCH it.
 * ⚠️ NOR IS ANOTHER TUNNEL TYPE. `/tunnels` lists every type, and a `warp_connector` (a Mesh node)
 *   shares the account's name space. An item whose `tun_type` is anything but `cfd_tunnel` is not
 *   ours even when the name matches. A response with no `tun_type` is accepted: it came from a
 *   `cfd_tunnel`-scoped call.
 */
export const observe = (raw: Raw): ObservedTunnel | undefined => {
  if (typeof raw.id !== 'string' || raw.id.length === 0) return undefined;
  if (raw.deletedAt !== undefined && raw.deletedAt !== null) return undefined;
  if (typeof raw.tunType === 'string' && raw.tunType !== 'cfd_tunnel') return undefined;
  const configSrc =
    raw.configSrc === 'cloudflare' || raw.configSrc === 'local' ? raw.configSrc : undefined;
  return { id: raw.id, name: raw.name ?? '', configSrc };
};

/** The tunnel with this id, or `undefined` when it is gone (404 / code 1002, or soft-deleted). */
export const getTunnel = (accountId: string, tunnelId: string) =>
  zeroTrust.getTunnelCloudflared({ accountId, tunnelId }).pipe(
    Effect.map(observe),
    Effect.catchTag('TunnelNotFound', () => Effect.succeed(undefined)),
  );

/**
 * The live cloudflared tunnel with exactly this name, or `undefined`.
 *
 * ★ `name` and `tunTypes` are sent as filters, but the match is re-checked here: the filter's
 *   exactness is not documented, and a prefix match would adopt the wrong tunnel.
 * ⛔ Two live matches is refused rather than resolved. Names are unique per account (the create
 *   answers code 1013 otherwise), so two means something this package does not understand.
 */
export const findTunnelByName = (accountId: string, name: string) =>
  zeroTrust.listTunnels.items({ accountId, name, isDeleted: false, tunTypes: ['cfd_tunnel'] }).pipe(
    Stream.map(observe),
    Stream.filter((t): t is ObservedTunnel => t !== undefined && t.name === name),
    Stream.runCollect,
    Effect.flatMap((chunk) => {
      const matches = Array.from(chunk);
      if (matches.length <= 1) return Effect.succeed(matches[0]);
      const ids = matches.map((t) => t.id).join(', ');
      return Effect.fail(
        new CloudflaredTunnelError({
          message: `Tunnel name "${name}" matches ${matches.length} live cloudflared tunnels (${ids}). Names are unique per account, so refusing to guess which one is meant.`,
        }),
      );
    }),
  );

/**
 * ⛔ ALWAYS `configSrc: 'cloudflare'` (remotely managed), NEVER OMITTED. The dashboard and the
 *   ingress rules a consumer later PUTs are the remote configuration; a `local` tunnel ignores
 *   them. The SDK types the field as optional with two values (zero_trust.ts
 *   `CreateTunnelCloudflaredRequest`) and does not say which is the default, so it is sent
 *   explicitly. Create-only (the PATCH body has `name` and `tunnelSecret` only).
 */
export const createTunnel = (accountId: string, name: string) =>
  zeroTrust.createTunnelCloudflared({ accountId, name, configSrc: 'cloudflare' }).pipe(
    Effect.flatMap((raw) => {
      const tunnel = observe(raw);
      return tunnel === undefined
        ? Effect.fail(
            new CloudflaredTunnelError({ message: `Creating tunnel "${name}" returned no id.` }),
          )
        : Effect.succeed(tunnel);
    }),
  );

/** ★ A rename is a PATCH: same id, same connectors, same `<id>.cfargotunnel.com` target. */
export const renameTunnel = (accountId: string, tunnelId: string, name: string) =>
  zeroTrust
    .patchTunnelCloudflared({ accountId, tunnelId, name })
    .pipe(Effect.map((raw) => observe(raw) ?? { id: tunnelId, name, configSrc: undefined }));

/**
 * ⚠️ The SDK types `deleteTunnelCloudflared`'s errors as `CloudflareOpError`, which has no
 *   `NotFound`, yet a 404 reaches the caller as `NotFound` at runtime (protocol.ts `HTTP_STATUS_MAP`,
 *   measured through the fake). So the tag is matched by name, not by `catchTag`'s typed union.
 */
const isNotFound = (error: { readonly _tag: string }) => error._tag === 'NotFound';

/**
 * ⛔ DELETE BY THE STORED ID ONLY, AFTER A READ BY THAT ID. Never by name: a name can have been
 *   re-used by another tunnel since this one was written, and a delete cannot be taken back. An
 *   empty id is refused before any request (a blank path segment would address the collection).
 * ★ Idempotent: a tunnel already gone or soft-deleted is a successful delete, including one that
 *   vanishes between the read and the DELETE (see `isNotFound`). The API refuses a
 *   delete while connectors are attached ("The tunnel must have no active connections", SDK doc on
 *   `deleteTunnelCloudflared`); that error passes through, since the operator must stop cloudflared.
 */
export const deleteTunnel = (accountId: string, tunnelId: string) =>
  Effect.gen(function* () {
    if (tunnelId.length === 0) {
      return yield* Effect.fail(
        new CloudflaredTunnelError({ message: 'Refusing to delete a tunnel with an empty id.' }),
      );
    }
    const live = yield* getTunnel(accountId, tunnelId);
    if (live === undefined) return;
    yield* zeroTrust
      .deleteTunnelCloudflared({ accountId, tunnelId })
      .pipe(Effect.catchIf(isNotFound, () => Effect.void));
  });
