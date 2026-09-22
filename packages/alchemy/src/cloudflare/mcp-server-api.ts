/**
 * The Access **AI Controls MCP server** calls a portal entry needs, and nothing else.
 *
 * ★ A PORTAL ENTRY IS ITS OWN OBJECT, NOT AN ACCESS APPLICATION. Cloudflare's MCP server portals
 *   model one upstream server as THREE objects: this one
 *   (`/accounts/{account_id}/access/ai-controls/mcp/servers`), the portal that aggregates it, and
 *   an Access application of type `mcp` whose only destination is
 *   `{ type: "via_mcp_server_portal", mcp_server_id: <this id> }`, which carries the policies that
 *   decide who SEES the server in the portal (developers.cloudflare.com/cloudflare-one/
 *   access-controls/ai-controls/secure-mcp-servers/ and .../mcp-portals/, read 2026-09-22).
 *   Alchemy beta.79 ships `Cloudflare.Access.McpPortal` for the second and says in its own doc
 *   comment that the first is "managed out of band (a future `Cloudflare.Access.McpServer`
 *   resource)". This is that resource; mcp-access-app.ts covers the third.
 *
 * ★ OVER `@distilled.cloud/cloudflare`, THE SDK ALCHEMY'S OWN CLOUDFLARE PROVIDERS USE. Measured
 *   2026-09-22: the official `cloudflare` npm SDK 4.5.0 has no AI Controls resources at all — its
 *   `src/resources/zero-trust/` stops at access/devices/dex/dlp/gateway/identity-providers/
 *   networks/organizations/risk-scoring/tunnels — while distilled `1.0.0-rc.12` carries all six
 *   verbs used below. So there is no path string this file invents.
 *
 * ⛔ THE SERVER ID IS CLIENT-SUPPLIED AND REQUIRED ON CREATE. `CreateAccessAiControlMcpServer
 *   Request.id` is a request field, not a server-generated one, which is why the resource takes it
 *   as a required prop: the Access application that governs the entry names the SAME id in its
 *   destination, so a generated id would have to be read back before the app could be declared.
 *
 * ⛔ NO TYPED `NotFound` EXISTS FOR THESE OPERATIONS. Measured 2026-09-22: every MCP-server verb
 *   declares its error channel as the bare `CloudflareOpError`, whose `DefaultErrors` are
 *   Unauthorized / TooManyRequests / InternalServerError / BadGateway / ServiceUnavailable /
 *   GatewayTimeout — `NotFound` and `Forbidden` are NOT in the union, though distilled's protocol
 *   constructs both at runtime from `HTTP_STATUS_MAP` (protocol.js, the 4xx branch). So "gone" is
 *   matched on the runtime `_tag` through `Effect.catchIf`; `Effect.catchTag('NotFound', …)` does
 *   not typecheck here, and a reviewer who "fixes" it to `catchTag` breaks the build, not the
 *   behaviour.
 */
import * as zeroTrust from '@distilled.cloud/cloudflare/zero-trust';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import * as Stream from 'effect/Stream';

/** How the portal authenticates to the upstream MCP server. */
export type McpServerAuthType = 'oauth' | 'bearer' | 'unauthenticated';

/** Cloudflare's four sync states for a portal entry's tool/prompt catalog. */
export type McpServerStatus = 'waiting' | 'ready' | 'stale' | 'error';

/** Whether an administrator still has to authenticate before a catalog sync can succeed. */
export type McpServerAuthenticationStatus =
  | 'not_required'
  | 'required'
  | 'connected'
  | 'stale'
  | 'manual';

/** A server-wide override for one tool or prompt the upstream server advertises. */
export interface McpCapabilityOverride {
  /** Name of the upstream capability being overridden. */
  readonly name: string;
  /** Custom name exposed through the portal. */
  readonly alias?: string;
  /** Custom description exposed through the portal. */
  readonly description?: string;
  /** Whether the capability is available through the portal at all. */
  readonly enabled?: boolean;
}

/** A live portal entry as this package sees it. ⛔ There is no credential field here, on purpose. */
export interface ObservedServer {
  readonly id: string;
  readonly name: string;
  readonly hostname: string;
  readonly authType: McpServerAuthType;
  readonly description: string | undefined;
  readonly isSharedOauthCallbackEnabled: boolean;
  readonly secureWebGateway: boolean;
  readonly status: McpServerStatus | undefined;
  readonly authenticationStatus: McpServerAuthenticationStatus | undefined;
  readonly lastSynced: string | undefined;
  readonly createdAt: string | undefined;
}

/** A refusal or failure, carrying the sentence an operator needs. Never a credential. */
export class McpServerError extends Data.TaggedError('McpServerError')<{
  readonly message: string;
}> {}

type Raw = {
  readonly id?: string | null;
  readonly name?: string | null;
  readonly hostname?: string | null;
  readonly authType?: string | null;
  readonly description?: string | null;
  readonly isSharedOauthCallbackEnabled?: boolean | null;
  readonly secureWebGateway?: boolean | null;
  readonly status?: string | null;
  readonly authenticationStatus?: string | null;
  readonly lastSynced?: string | null;
  readonly createdAt?: string | null;
};

const AUTH_TYPES: readonly string[] = ['oauth', 'bearer', 'unauthenticated'];
const STATUSES: readonly string[] = ['waiting', 'ready', 'stale', 'error'];
const AUTHENTICATION_STATUSES: readonly string[] = [
  'not_required',
  'required',
  'connected',
  'stale',
  'manual',
];

const oneOf = <T extends string>(allowed: readonly string[], value: unknown): T | undefined =>
  typeof value === 'string' && allowed.includes(value) ? (value as T) : undefined;

/**
 * ⚠️ AN UNRECOGNISED `auth_type` IS NOT A PORTAL ENTRY THIS RESOURCE UNDERSTANDS. The field is
 *   required on every documented response, so `undefined` means Cloudflare grew a fourth mode —
 *   dropping the row is safer than recording a value the diff would then compare against.
 */
export const observe = (raw: Raw): ObservedServer | undefined => {
  if (typeof raw.id !== 'string' || raw.id.length === 0) return undefined;
  const authType = oneOf<McpServerAuthType>(AUTH_TYPES, raw.authType);
  if (authType === undefined) return undefined;
  return {
    id: raw.id,
    name: raw.name ?? '',
    hostname: raw.hostname ?? '',
    authType,
    description: raw.description || undefined,
    isSharedOauthCallbackEnabled: raw.isSharedOauthCallbackEnabled ?? false,
    secureWebGateway: raw.secureWebGateway ?? false,
    status: oneOf<McpServerStatus>(STATUSES, raw.status),
    authenticationStatus: oneOf<McpServerAuthenticationStatus>(
      AUTHENTICATION_STATUSES,
      raw.authenticationStatus,
    ),
    lastSynced: raw.lastSynced ?? undefined,
    createdAt: raw.createdAt ?? undefined,
  };
};

const tagged = (tag: string) => (error: unknown) =>
  Predicate.hasProperty(error, '_tag') && error['_tag'] === tag;

const isNotFound = tagged('NotFound');
const isForbidden = tagged('Forbidden');

/**
 * ⛔ `Forbidden` HERE MEANS "NO AI CONTROLS ENTITLEMENT", NOT "WRONG TOKEN". Alchemy's own
 *   `McpPortal` treats a 403 on its LIST as "this account has no portals"; on a read or a write
 *   that would hide the one fact an operator needs, so it is turned into a sentence instead.
 */
const entitlement = (what: string) =>
  new McpServerError({
    message:
      `Cloudflare refused ${what} with 403. On the AI Controls MCP endpoints that means the ` +
      'account does not have the entitlement (the product is in open beta and must be enabled ' +
      'for the account), not that the API token is wrong — a wrong token answers 401.',
  });

const withEntitlement = <A, E, R>(what: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.catchIf(isForbidden, () => Effect.fail(entitlement(what))));

/** The portal entry with this id, or `undefined` when it does not exist. */
export const getServer = (
  accountId: string,
  serverId: string,
): Effect.Effect<ObservedServer | undefined, unknown, zeroTrust.CloudflareOpContext> =>
  withEntitlement(
    `reading MCP server "${serverId}"`,
    zeroTrust.readAccessAiControlMcpServer({ accountId, id: serverId }).pipe(Effect.map(observe)),
  ).pipe(Effect.catchIf(isNotFound, () => Effect.succeed(undefined)));

/** Every portal entry in the account. ⚠️ An account without the entitlement has none. */
export const listServers = (
  accountId: string,
): Effect.Effect<readonly ObservedServer[], unknown, zeroTrust.CloudflareOpContext> =>
  zeroTrust.listAccessAiControlMcpServers.items({ accountId }).pipe(
    Stream.map(observe),
    Stream.filter((server): server is ObservedServer => server !== undefined),
    Stream.runCollect,
    Effect.map((chunk) => Array.from(chunk)),
    Effect.catchIf(isForbidden, () => Effect.succeed([] as readonly ObservedServer[])),
  );

/** The fields a create carries beyond the identity. `undefined` keys are omitted, never sent. */
export interface ServerWrite {
  readonly name: string;
  readonly description?: string;
  readonly isSharedOauthCallbackEnabled?: boolean;
  readonly secureWebGateway?: boolean;
  readonly updatedTools?: readonly McpCapabilityOverride[];
  readonly updatedPrompts?: readonly McpCapabilityOverride[];
  /** Resolved at call time from the deploying process's environment. Never stored. */
  readonly authCredentials?: string;
  /** Resolved at call time from the deploying process's environment. Never stored. */
  readonly clientSecret?: string;
}

const optional = (write: ServerWrite) => ({
  ...(write.description === undefined ? {} : { description: write.description }),
  ...(write.isSharedOauthCallbackEnabled === undefined
    ? {}
    : { isSharedOauthCallbackEnabled: write.isSharedOauthCallbackEnabled }),
  ...(write.secureWebGateway === undefined ? {} : { secureWebGateway: write.secureWebGateway }),
  ...(write.updatedTools === undefined ? {} : { updatedTools: [...write.updatedTools] }),
  ...(write.updatedPrompts === undefined ? {} : { updatedPrompts: [...write.updatedPrompts] }),
  ...(write.authCredentials === undefined ? {} : { authCredentials: write.authCredentials }),
  ...(write.clientSecret === undefined ? {} : { clientSecret: write.clientSecret }),
});

/**
 * ⛔ `hostname` AND `authType` ARE SENT ON CREATE AND NOWHERE ELSE. Measured 2026-09-22 against
 *   the SDK: `UpdateAccessAiControlMcpServerRequest` carries `authCredentials`, `clientSecret`,
 *   `description`, `isSharedOauthCallbackEnabled`, `name`, `secureWebGateway`, `updatedPrompts`
 *   and `updatedTools` — and NEITHER `hostname` NOR `authType`. So changing either is a replace,
 *   not an update, and mcp-server-form.ts says so in `diff`.
 */
export const createServer = (
  accountId: string,
  serverId: string,
  hostname: string,
  authType: McpServerAuthType,
  write: ServerWrite,
): Effect.Effect<ObservedServer, unknown, zeroTrust.CloudflareOpContext> =>
  withEntitlement(
    `creating MCP server "${serverId}"`,
    zeroTrust
      .createAccessAiControlMcpServer({
        accountId,
        id: serverId,
        hostname,
        authType,
        name: write.name,
        ...optional(write),
      })
      .pipe(
        Effect.flatMap((raw) => {
          const server = observe(raw);
          return server === undefined
            ? Effect.fail(
                new McpServerError({
                  message: `Creating MCP server "${serverId}" returned no id or an unknown auth_type.`,
                }),
              )
            : Effect.succeed(server);
        }),
      ),
  );

/** An in-place update of the mutable fields. The identity, hostname and auth type never move. */
export const updateServer = (
  accountId: string,
  serverId: string,
  write: ServerWrite,
): Effect.Effect<ObservedServer | undefined, unknown, zeroTrust.CloudflareOpContext> =>
  withEntitlement(
    `updating MCP server "${serverId}"`,
    zeroTrust
      .updateAccessAiControlMcpServer({ accountId, id: serverId, name: write.name, ...optional(write) })
      .pipe(Effect.map(observe)),
  );

/**
 * Refresh the entry's tool and prompt catalog from the upstream server.
 *
 * ⛔ BEST EFFORT, AND THE DEPLOY NEVER FAILS ON IT. An `oauth` entry reports
 *   `authentication_status: "required"` until an administrator completes the upstream OAuth flow
 *   in the dashboard, and a sync before that cannot succeed. Failing the create over it would make
 *   the FIRST deploy of every Access-protected MCP server red while the object it created is
 *   correct. The observed `status` is recorded instead, so a plan shows `waiting` or `error`.
 */
export const syncServer = (
  accountId: string,
  serverId: string,
): Effect.Effect<McpServerStatus | undefined, never, zeroTrust.CloudflareOpContext> =>
  zeroTrust.syncAccessAiControlMcpServer({ accountId, id: serverId }).pipe(
    Effect.map((raw) => oneOf<McpServerStatus>(STATUSES, raw.status)),
    Effect.catchCause(() => Effect.succeed(undefined)),
  );

/** Idempotent: an entry already gone is a successful delete. */
export const deleteServer = (
  accountId: string,
  serverId: string,
): Effect.Effect<void, unknown, zeroTrust.CloudflareOpContext> =>
  withEntitlement(
    `deleting MCP server "${serverId}"`,
    zeroTrust.deleteAccessAiControlMcpServer({ accountId, id: serverId }).pipe(Effect.asVoid),
  ).pipe(Effect.catchIf(isNotFound, () => Effect.void));
