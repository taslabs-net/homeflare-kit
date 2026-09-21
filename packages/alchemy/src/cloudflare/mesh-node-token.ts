/**
 * `fetchMeshNodeToken` — a Mesh node's enrolment token, fetched on demand for a one-off Bun
 * `mesh-enroll` step. ⛔ Not a Resource, and never an attribute: see mesh-node-form.ts for why
 * the token must stay out of Alchemy state.
 *
 * ⛔ WHERE THE VALUE MAY GO. Straight into a root-owned `0600` file on the node's host, which the
 *   enrolment reads (`warp-cli --accept-tos connector new <token>`, per the Mesh get-started page,
 *   read 2026-09-21). Nowhere else: not Alchemy state, not the vault (plan decision: a runtime
 *   credential lives outside both), not a log line, not a CI variable. It is returned `Redacted`,
 *   so an accidental `console.log` or `Effect.log` prints `<redacted>`; call `Redacted.value` only
 *   at the write.
 * ⚠️ `warp-cli` takes the token as an ARGUMENT, so it is visible in the host's process list for
 *   the life of that command. Run the enrolment as root on the node itself, never over a shell
 *   whose history is kept.
 * ⚠️ THE ENDPOINT NEEDS A WRITE PERMISSION: "Cloudflare One Connectors Write" (or the cloudflared
 *   or Tunnel Write groups) per its API reference, read 2026-09-21. Mint a short-lived token for
 *   this step alone; a read-only plan token gets a 403 here.
 *
 * ★ Requires distilled `Credentials` and an `HttpClient`, not Alchemy's CloudflareEnvironment: a
 *   Bun script has no Alchemy profile, so the account id is an argument. Provide
 *   `Credentials.fromApiToken({ apiToken })` (from `@distilled.cloud/cloudflare/Credentials`) and
 *   `FetchHttpClient.layer`. ⛔ Not `Credentials.fromEnv()`: it falls back to the Global API Key
 *   (`CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`) when no token is set.
 */
import * as zeroTrust from '@distilled.cloud/cloudflare/zero-trust';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { MeshNodeError, findNodeByName } from './mesh-node-api.ts';

/** Which node: by id (the `MeshNode` attribute) or by its exact name. */
export type MeshNodeRef = { readonly accountId: string } & (
  | { readonly id: string; readonly name?: undefined }
  | { readonly name: string; readonly id?: undefined }
);

const resolveId = (ref: MeshNodeRef) => {
  if (ref.id !== undefined) return Effect.succeed(ref.id);
  const name = ref.name;
  return Effect.flatMap(findNodeByName(ref.accountId, name), (node) =>
    node === undefined
      ? Effect.fail(new MeshNodeError({ message: `No live Mesh node named "${name}".` }))
      : Effect.succeed(node.id),
  );
};

/**
 * ⛔ An EMPTY token fails closed: `warp-cli connector new ""` would not enrol, and a script that
 *   wrote an empty file would report success over a host that never joined.
 * ⛔ The failures made here name the node and account and quote no response body, because the
 *   success body IS the token. Other SDK errors pass through; they come only from non-2xx
 *   responses, which carry an error envelope, not a token.
 */
export const fetchMeshNodeToken = (ref: MeshNodeRef) =>
  Effect.gen(function* () {
    const nodeId = yield* resolveId(ref);
    const token = yield* zeroTrust
      .getTunnelWarpConnectorToken({ accountId: ref.accountId, tunnelId: nodeId })
      .pipe(
        Effect.catchTag('TunnelNotFound', () =>
          Effect.fail(
            new MeshNodeError({
              message: `Mesh node ${nodeId} does not exist in account ${ref.accountId}.`,
            }),
          ),
        ),
        Effect.catchTag('Forbidden', () =>
          Effect.fail(
            new MeshNodeError({
              message: `Reading Mesh node ${nodeId}'s token was refused (403). The endpoint needs a Write permission such as "Cloudflare One Connectors Write".`,
            }),
          ),
        ),
      );
    if (typeof token !== 'string' || token.length === 0) {
      return yield* Effect.fail(
        new MeshNodeError({ message: `Mesh node ${nodeId} returned an empty token.` }),
      );
    }
    return Redacted.make(token);
  });
