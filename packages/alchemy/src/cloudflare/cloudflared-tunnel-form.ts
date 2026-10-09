/**
 * `Cloudflare.CloudflaredTunnel` — its props, its attributes, and the pure `diff`.
 *
 * ⛔ THE ATTRIBUTES NEVER HOLD A TOKEN OR A SECRET. That is the reason this resource exists next to
 *   Alchemy's `Cloudflare.Tunnel.Tunnel` (beta.81): its `reconcile`, `read` and `list` all call
 *   `getTunnelCloudflaredToken` and keep the result as `token: Redacted<string>`, which
 *   `encodeState` persists as `{"__redacted__": "<token>"}` in the (unencrypted) state store. That
 *   token is what `cloudflared tunnel run --token` accepts: whoever reads state can run a connector
 *   for the tunnel and receive its traffic. It also makes every PLAN need a token with a Write
 *   permission. This resource never calls the endpoint, so a plan runs on a read token.
 * ★ THE CONNECTOR'S TOKEN IS A RUNTIME CREDENTIAL, NOT INFRASTRUCTURE STATE. Whatever installs the
 *   connector fetches it at that moment and hands it straight to the workload's secret store.
 *   Nothing here does, and nothing here exports a helper that would.
 * ★ SCOPE: the tunnel object only. No ingress rules, no routes, no DNS, no connector Deployment:
 *   those are separate declarations that name this tunnel's `id`.
 */
import type { Diff } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { CloudflaredTunnelError, type TunnelStatus } from './cloudflared-tunnel-api.ts';

export interface CloudflaredTunnelProps {
  /**
   * The tunnel's name in the account — and its identity when adopting (names are unique per
   * account). ★ Changing it RENAMES the tunnel in place (`PATCH`): the id, the connectors and the
   * `<id>.cfargotunnel.com` target survive.
   */
  readonly name: string;
}

export interface CloudflaredTunnelAttributes {
  /** The tunnel's UUID: the `<id>.cfargotunnel.com` target and the key for ingress rules. */
  readonly id: string;
  /**
   * The account the provider environment resolved when the tunnel was written. Not a secret; it
   * is what `delete` and `read` address, so they never act on the current environment's account.
   */
  readonly accountId: string;
  readonly name: string;
  /** As of the last read or write; it moves on its own as connectors attach and drop. */
  readonly status: TunnelStatus | undefined;
}

/** ⛔ Fail closed on a declaration the API would accept but nobody meant. */
export const validateCloudflaredTunnel = (
  props: CloudflaredTunnelProps,
): CloudflaredTunnelError | undefined => {
  if (typeof props.name !== 'string' || props.name.trim().length === 0) {
    return new CloudflaredTunnelError({
      message: 'CloudflaredTunnel `name` must be a non-empty string.',
    });
  }
  if (props.name !== props.name.trim()) {
    return new CloudflaredTunnelError({
      message: `CloudflaredTunnel name "${props.name}" has leading or trailing whitespace; adoption matches names exactly.`,
    });
  }
  return undefined;
};

/**
 * update or replace, from the declaration and what was last written.
 *
 * - Account changed → `replace`, create-first: names are unique per ACCOUNT, so the two
 *   generations cannot collide.
 * - Name changed → `update` (a PATCH rename).
 * - Otherwise → no opinion; the engine compares props.
 */
export const diffCloudflaredTunnel = (
  news: Input<CloudflaredTunnelProps>,
  output: CloudflaredTunnelAttributes | undefined,
  accountId: string,
): Diff | undefined => {
  if (output === undefined) return undefined;
  if (output.accountId !== accountId) return { action: 'replace' };
  const name = (news as { readonly name?: unknown }).name;
  if (typeof name === 'string' && name !== output.name) return { action: 'update' };
  return undefined;
};
