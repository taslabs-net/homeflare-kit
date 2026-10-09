/**
 * read / reconcile / delete for `Cloudflare.CloudflaredTunnel`, as plain Effects over the SDK calls
 * in cloudflared-tunnel-api.ts. cloudflared-tunnel.ts only wires them into Alchemy.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import {
  CloudflaredTunnelError,
  type ObservedTunnel,
  createTunnel,
  deleteTunnel,
  findTunnelByName,
  getTunnel,
  renameTunnel,
} from './cloudflared-tunnel-api.ts';
import {
  type CloudflaredTunnelAttributes,
  type CloudflaredTunnelProps,
  validateCloudflaredTunnel,
} from './cloudflared-tunnel-form.ts';

const attributesOf = (tunnel: ObservedTunnel, accountId: string): CloudflaredTunnelAttributes => ({
  id: tunnel.id,
  accountId,
  name: tunnel.name,
  status: tunnel.status,
});

/**
 * Owned: refresh by the stored id. Cold: find the live tunnel by exact name and hand it back
 * `Unowned`, so Alchemy refuses to take it over until the stack says `adopt(true)` — a
 * `cfd_tunnel` carries no ownership marker to prove it was ours. Adoption is idempotent: the
 * adopted row holds the id, so every later `read` takes the owned path and writes nothing.
 */
export const readCloudflaredTunnel = (
  accountId: string,
  olds: CloudflaredTunnelProps | undefined,
  output: CloudflaredTunnelAttributes | undefined,
) =>
  Effect.gen(function* () {
    const account = output?.accountId ?? accountId;
    if (output !== undefined) {
      const tunnel = yield* getTunnel(account, output.id);
      if (tunnel !== undefined) return attributesOf(tunnel, account);
    }
    const name = olds?.name ?? output?.name;
    if (name === undefined) return undefined;
    const match = yield* findTunnelByName(account, name);
    return match === undefined ? undefined : Unowned(attributesOf(match, account));
  });

/**
 * ⛔ NEVER CONVERGE ON A TUNNEL THIS RESOURCE DID NOT FIND BY ITS OWN ID. Alchemy's own Tunnel
 *   answers a duplicate-name failure by re-reading the holder and returning it (when its `adopt`
 *   prop is set). Here adoption belongs to `read` and `adopt(true)` alone, where it is visible in
 *   the plan. The holder is named, never deleted: it may be a live tunnel that serves traffic.
 */
const nameHeld = (name: string, holder: string) =>
  new CloudflaredTunnelError({
    message:
      `A tunnel named "${name}" already exists (${holder}) and is not the tunnel this resource ` +
      'tracks, so it is left alone: names are unique per account. If it is meant to be this ' +
      'one, deploy under adopt(true). Otherwise choose another name; do not delete it.',
  });

/**
 * 🔴 A 1013 AFTER A CLEAN LOOKUP IS USUALLY THIS DEPLOY'S OWN TUNNEL. distilled retries a POST on a
 *   transport error or a 5xx, so a create that succeeded but lost its response is sent again and
 *   answered 1013 by the tunnel the first attempt made. The lookup is repeated so the sentence
 *   names that tunnel; it is still not adopted here, because a concurrent creator looks the same.
 */
const raced = (accountId: string, name: string) =>
  findTunnelByName(accountId, name).pipe(
    Effect.flatMap((holder) =>
      Effect.fail(
        holder === undefined
          ? nameHeld(
              name,
              'not a live cloudflared tunnel: another tunnel type, or one just deleted',
            )
          : new CloudflaredTunnelError({
              message:
                `Tunnel "${name}" (${holder.id}) appeared between this deploy's lookup and its ` +
                'create. The likeliest cause is this deploy itself: the SDK retries a create ' +
                'whose response was lost. If so, deploy again under adopt(true). Otherwise ' +
                'another creator raced this one.',
            }),
      ),
    ),
  );

const createFresh = (accountId: string, name: string) =>
  Effect.gen(function* () {
    const existing = yield* findTunnelByName(accountId, name);
    if (existing !== undefined) return yield* Effect.fail(nameHeld(name, existing.id));
    const tunnel = yield* createTunnel(accountId, name).pipe(
      Effect.catchTag('DuplicateTunnelName', () => raced(accountId, name)),
    );
    return attributesOf(tunnel, accountId);
  });

/**
 * ⛔ `local` IS REFUSED. A tunnel's `config_src` is create-only, and adoption by name could land on
 *   a locally configured tunnel, whose ingress is a YAML file on its origin: a consumer's remote
 *   rules would be accepted by the API and never applied. The tunnel is left untouched.
 */
const requireRemote = (tunnel: ObservedTunnel) =>
  tunnel.configSrc === 'local'
    ? Effect.fail(
        new CloudflaredTunnelError({
          message: `Tunnel "${tunnel.name}" (${tunnel.id}) is locally configured (config_src local), which cannot be changed after creation. CloudflaredTunnel manages remotely configured tunnels only; create a new tunnel under another name.`,
        }),
      )
    : Effect.void;

export const reconcileCloudflaredTunnel = (
  accountId: string,
  news: CloudflaredTunnelProps,
  output: CloudflaredTunnelAttributes | undefined,
) =>
  Effect.gen(function* () {
    const invalid = validateCloudflaredTunnel(news);
    if (invalid !== undefined) return yield* Effect.fail(invalid);
    const owned = output !== undefined && output.accountId === accountId ? output : undefined;
    const live = owned === undefined ? undefined : yield* getTunnel(accountId, owned.id);
    // ★ Gone out of band (or a replace's new generation): create, under the same refusals.
    if (owned === undefined || live === undefined) return yield* createFresh(accountId, news.name);
    yield* requireRemote(live);
    if (live.name === news.name) return attributesOf(live, accountId);
    const renamed = yield* renameTunnel(accountId, live.id, news.name).pipe(
      Effect.catchTag('DuplicateTunnelName', () =>
        Effect.fail(nameHeld(news.name, 'held by another tunnel')),
      ),
    );
    return attributesOf(renamed, accountId);
  });

/** By the stored id and account only (cloudflared-tunnel-api.ts, `deleteTunnel`). */
export const deleteCloudflaredTunnel = (output: CloudflaredTunnelAttributes) =>
  deleteTunnel(output.accountId, output.id);
