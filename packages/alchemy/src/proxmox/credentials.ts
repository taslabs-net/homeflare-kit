/**
 * The PVE credential a reconcile runs with: minted from OpenBao, alive for five minutes.
 *
 * ⛔ THERE IS NO STATIC WRITE TOKEN IN THIS ESTATE, AND THAT IS DELIBERATE. Every PVE token stored
 *   on the estate's static KV shelf is read-only — PVEAuditor on each cluster, Audit on PBS, all
 *   as one metrics user. The MCP proxmox client says why in its own header: the auditor token bounds
 *   what a BUG can do, independently of what the code bounds. Adding a long-lived write token to
 *   that shelf would delete the outer lock for every reader of the shelf, not just for this
 *   provider.
 *
 * ★ SO WRITES COME FROM A DYNAMIC MOUNT INSTEAD, which the estate already built: `proxmox-c1/`
 *   exposes two roles — `read` (ttl 3600s) and `provision` (ttl 300s, max 1800s, NOT renewable).
 *   A mint returns a PVE API token of its own, `hf-provision@pve!hf-provision-…-<timestamp>-<id>`,
 *   which expires on its own whether or not anything cleans up. Same shape as
 *   `cloudflare-<account>-<surface>/creds/<role>`, same reason.
 *   ⚠️ THAT PATH IS WRITTEN WITH `<surface>` RATHER THAN A GLOB ON PURPOSE: a `*` followed by
 *     a slash CLOSES THIS BLOCK COMMENT, and everything below it then parses as code. It cost
 *     six TS1005/TS1443 errors pointing at innocent lines twenty rows further down.
 *
 * ⚠️ FIVE MINUTES IS THE DESIGN, NOT AN OBSTACLE. A reconcile that cannot finish inside the lease
 *   should mint again rather than ask for a longer one: the short lease is what makes a leaked
 *   token uninteresting. `provision` is explicitly non-renewable, so there is no renew path to
 *   reach for.
 *
 * ⛔ THE SECRET NEVER TOUCHES DISK, A LOG, OR ALCHEMY STATE. Alchemy persists resource attributes
 *   WITHOUT encryption — StateEncoding.ts writes `Redacted` as `{"@redacted": <plaintext>}` — and
 *   this estate's state store is the `alchemy` Postgres, which a nightly job dumps. A PVE
 *   secret that reached an attribute would outlive its 300s lease by months, in four places.
 *   Nothing here returns it to a resource; it is used to build a header and then dropped.
 */
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as Headers from 'effect/unstable/http/Headers';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';

/**
 * ★ NO SESSION, ON PURPOSE, AND THIS IS WHAT UNBLOCKED `wip/bao-policy`.
 *   `CommandExecutor.run` requires a `ScopedPlanStatusSession`, and Alchemy gives one to
 *   `reconcile` and `delete` but NOT to `read` or `diff` — so a provider built on `run` can only
 *   ever write. Alchemy's OWN Docker provider does not use `CommandExecutor` for this at all: it
 *   takes `ChildProcessSpawner` and pipes `ChildProcess.make(...)` through `spawner.spawn`, which
 *   needs a `Scope` and nothing else (Docker.ts:476-553). That was the pattern here until
 *   2026-09-14, when `mint` moved to `HttpClient` — which needs no session either, so `mint` is
 *   still callable from all four operations.
 *
 * ⛔ DO NOT SATISFY THE OLD SIGNATURE BY FAKING A SESSION. A session carries plan status Alchemy
 *   uses to report progress; inventing one would make read and diff report work they are not doing.
 */
/** Which role a call needs. `read` for read/diff, `provision` for reconcile/delete. */
export type PveRole = 'read' | 'provision';

/**
 * Where credentials come from, and which cluster they are for.
 *
 * ⚠️ A PARAMETER, NOT A CONSTANT, SO THIS PACKAGE CAN LEAVE THE ESTATE. Everything
 *   HomeFlare-specific — the mount name, the API host — belongs in the stack that declares
 *   resources, not in the provider. Anyone with an OpenBao mount that vends Proxmox API tokens can
 *   use this file unchanged; that is the whole difference between a provider and a script.
 */
export type PveTarget = {
  /** OpenBao mount that vends API tokens for this host, e.g. `proxmox-c1`. */
  readonly mount: string;
  /**
   * mgmt hostnames for cluster members, e.g. `node-b.mgmt.example.com`. Any member's :8006 API
   * manages the whole cluster; `client.ts` failovers across them.
   */
  readonly members: readonly string[];
  /**
   * Which product answers at `api`. Defaults to `pve`.
   *
   * ★ PBS IS THE SAME CLIENT WITH A DIFFERENT AUTHORIZATION HEADER, AND THAT IS WHY THERE IS NO
   *   SECOND CLIENT HERE. Proxmox Backup Server speaks the same `/api2/json` paths, wraps every
   *   answer in the same `{"data": …}` envelope, and its OpenBao mount vends the same
   *   `{token_id, secret}` shape — so `mint`, `pve()` and `pveOperations` all work against it
   *   unchanged. The ONE difference is the header scheme: PVE spells it
   *   `PVEAPIToken=<id>=<secret>` and PBS spells it `PBSAPIToken=<id>:<secret>` — a different
   *   prefix AND a different separator.
   *
   * ⛔ IT IS REQUIRED, NOT OPTIONAL, AND THAT IS THE WHOLE TYPE-SAFETY ARGUMENT. A PBS target and
   *   a PVE target are the same two strings, so with an OPTIONAL discriminant TypeScript's
   *   structural typing would accept a PBS host wherever a PVE one belongs — and `pve()` would
   *   then build `PVEAPIToken=<id>=<secret>` against a server wanting
   *   `PBSAPIToken=<id>:<secret>`. Every call 401s, `pveOperations.read` folds that into "absent",
   *   the plan says CREATE for an object that is plainly there, the POST is refused, and not one
   *   symptom points at the header. Required, the mistake is a compile error instead.
   *
   * ⚠️ REASONED FROM PBS'S DOCUMENTED SCHEME, NOT MEASURED. The estate has no PBS credential yet
   *   (there is no PBS mount in OpenBao), and an unauthenticated probe cannot tell the schemes
   *   apart — `https://pbs.example.com:8007/api2/json/nodes` answers 401 to a missing header, a
   *   PVE-shaped one and a PBS-shaped one alike. The first real token will confirm or correct it,
   *   and a wrong guess fails closed with a 401 rather than doing something odd.
   */
  readonly scheme: 'pve';
};

/** The same client against a Proxmox Backup Server. See the ⛔ on `scheme` above. */
export type PbsTarget = {
  readonly mount: string;
  readonly api: string;
  readonly scheme: 'pbs';
};

/** Either product. What `pve()` and `pveOperations` accept; what a RESOURCE accepts is narrower. */
export type ApiTarget = PbsTarget | PveTarget;

/**
 * What a mint returns.
 *
 * ⚠️ `secret` IS PRESENT AND MUST NOT BE PERSISTED. It is typed as a plain string rather than
 *   `Redacted` on purpose: Alchemy's Redacted is a STATE-ENCODING marker, not encryption, so
 *   wrapping it would imply a protection that does not exist. The protection here is that this
 *   value never leaves the function that builds the Authorization header.
 */
export type PveCredential = {
  /** `hf-provision@pve!hf-provision-…` — an identifier, safe to log. */
  readonly tokenId: string;
  /** ⛔ NEVER LOG, NEVER PERSIST, NEVER RETURN FROM A RESOURCE. */
  readonly secret: string;
  /** Seconds the lease was granted for, as reported by OpenBao. */
  readonly leaseSeconds: number;
};

/** The environment `mint` resolves OpenBao from — `process.env` unless a test passes its own. */
export type BaoEnvironment = Readonly<Record<string, string | undefined>>;

/** openbao v2.6.2 api/env.go:22-34 — a present BAO_* wins, even empty; else its VAULT_* twin. */
const baoVariable = (env: BaoEnvironment, name: string) =>
  env[`BAO_${name}`] ?? env[`VAULT_${name}`] ?? '';

/**
 * Mint one credential for `role`: `GET /v1/<mount>/creds/<role>` on OpenBao's HTTP API.
 *
 * 🔴 IT SHELLED OUT TO `bao read -format=json` UNTIL 2026-09-14. The case for the CLI was that one
 *   client could not disagree with `bao kv get` about what this machine may do. <estate>/openbao then
 *   learned twice what deciding by stderr costs — every failure read as absent, and two commands
 *   said "absent" in different words — so this reads STATUS CODES: 2xx is a credential, and 403
 *   (denied), 404 (no such role or mount — a mint has no "absent"), 503 (sealed) all fail.
 * ★ THE ENVIRONMENT CONTRACT IS STILL THE CLI's, READ THE CLI's WAY, which keeps the case above
 *   true (openbao v2.6.2 api/client.go:34-66, 370, 503-507, 761-762, 776-785): BAO_AGENT_ADDR over
 *   BAO_ADDR over https://127.0.0.1:8200; BAO_NAMESPACE as X-Vault-Namespace; BAO_TOKEN as
 *   X-Vault-Token; X-Vault-Request always. <estate>/openbao/src/bao-address.ts has the long form.
 * ★ AGENT MODE IS NO BAO_TOKEN AND NO TOKEN HEADER. An Agent or Proxy listener with
 *   `api_proxy { use_auto_auth_token = true }` (or the older `cache { … }`) substitutes its
 *   auto-auth token exactly when a request carries none — command/agentproxyshared/cache/handler.go
 *   :29-38, command/agent.go:517-541, command/agent/config/config.go:288-292, and
 *   website/content/docs/agent-and-proxy/agent/apiproxy.mdx:57-62. The CLI's token-file fallback
 *   is deliberately not read. ⚠️ So an unset BAO_TOKEN aimed at a SERVER rather than an agent is a
 *   403, which reads like a missing grant rather than a missing variable.
 * ★ UNIX SOCKETS: `unix:///path` is plain HTTP to `localhost` over that socket, as the CLI does it
 *   (api/client.go:654-667). Bun's fetch takes a `unix` option; `FetchHttpClient.RequestInit` is
 *   Effect's documented way to pass fetch options, read from the calling fiber (effect
 *   FetchHttpClient.ts:59-72). Off Bun it REFUSES, rather than reach http://localhost:80.
 */
export const mint = (target: ApiTarget, role: PveRole, env: BaoEnvironment = process.env) =>
  Effect.gen(function* () {
    const path = `${target.mount}/creds/${role}`;
    // ⛔ METHOD, PATH AND OpenBao's `errors` ONLY — never a header (the token), never a success
    //   body (the credential is IN it, so echoing it would print the secret into a log).
    const refuse = (status: number, detail: string) =>
      new Error(`OpenBao GET /v1/${path} -> ${status === 0 ? 'no response' : status}: ${detail}`);
    const address =
      baoVariable(env, 'AGENT_ADDR') || baoVariable(env, 'ADDR') || 'https://127.0.0.1:8200';
    const socket = address.startsWith('unix://') ? address.slice('unix://'.length) : undefined;
    const base = socket === undefined ? address.replace(/\/+$/, '') : 'http://localhost';
    const headers: Record<string, string> = { 'X-Vault-Request': 'true' };
    const namespace = baoVariable(env, 'NAMESPACE');
    if (namespace !== '') headers['X-Vault-Namespace'] = namespace;
    const token = baoVariable(env, 'TOKEN');
    if (token !== '') headers['X-Vault-Token'] = token;
    if (socket !== undefined && !('Bun' in globalThis)) {
      return yield* Effect.fail(refuse(0, 'a unix:// address needs Bun fetch; this is not Bun'));
    }

    const client = yield* HttpClient.HttpClient;
    // ⛔ Effect records request headers on the client span, and its default redaction list does
    //   not name x-vault-token (effect Headers.ts:753-762). It is added for this call.
    const redacted = yield* Headers.CurrentRedactedNames;
    const defaults = Option.getOrElse(
      yield* Effect.serviceOption(FetchHttpClient.RequestInit),
      () => ({}),
    );
    const request = HttpClientRequest.get(`${base}/v1/${path}`).pipe(
      HttpClientRequest.setHeaders(headers),
    );
    const exchange = client.execute(request).pipe(
      Effect.flatMap((response) =>
        Effect.map(response.text, (text) => ({ status: response.status, text })),
      ),
      // ⚠️ The CLI's default client timeout (api/client.go:324) — a hung agent must not hang a plan.
      Effect.timeout('60 seconds'),
      Effect.provideService(Headers.CurrentRedactedNames, [...redacted, 'x-vault-token']),
    );
    // ⚠️ `| undefined` under exactOptionalPropertyTypes: `socket` is narrowed to a string
    //   only on the branch below, so the object literal genuinely carries
    //   `unix: string | undefined` and the type must say so. The alternative — building
    //   the key conditionally — hides that this request is the unix-socket path.
    const init: RequestInit & { unix?: string | undefined } = { ...defaults, unix: socket };
    const { status, text } = yield* (
      socket === undefined
        ? exchange
        : Effect.provideService(exchange, FetchHttpClient.RequestInit, init)
    ).pipe(
      // ⛔ `.message` only — the error object holds the request, and the request holds the token.
      Effect.mapError((cause) => refuse(0, cause.message)),
    );

    let parsed:
      | {
          lease_duration?: unknown;
          data?: { token_id?: unknown; secret?: unknown };
          errors?: unknown;
        }
      | undefined;
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      parsed = undefined;
    }
    if (status < 200 || status >= 300) {
      const errors = parsed?.errors;
      const detail = Array.isArray(errors)
        ? errors.map(String).join('; ')
        : 'not an OpenBao error body';
      return yield* Effect.fail(refuse(status, detail || '(no errors given)'));
    }
    const tokenId = parsed?.data?.token_id;
    const secret = parsed?.data?.secret;
    if (typeof tokenId !== 'string' || typeof secret !== 'string') {
      // ⛔ REFUSE RATHER THAN RETURN A HALF CREDENTIAL, and again WITHOUT quoting the body.
      return yield* Effect.fail(
        new Error(
          `${target.mount}/creds/${role} returned no token_id/secret. Either this approle lacks ` +
            `the grant, or the mount is not ${target.mount}. Say which mount and role you needed ` +
            `than falling back to a stored credential -- every stored PVE token is read-only.`,
        ),
      );
    }
    const lease = parsed?.lease_duration;
    const leaseSeconds = typeof lease === 'number' ? lease : 0;
    return { leaseSeconds, secret, tokenId } satisfies PveCredential;
  });

/**
 * The header PVE wants. `PVEAPIToken=<tokenid>=<secret>`.
 *
 * ⚠️ THE SEPARATOR IS `=`, NOT `:`. Proxmox rejects the colon form with a 401 that says only
 *   "authentication failure", which reads as a bad credential rather than as a malformed header.
 */
export const authorization = (credential: PveCredential, target: ApiTarget): string =>
  target.scheme === 'pbs'
    ? `PBSAPIToken=${credential.tokenId}:${credential.secret}`
    : `PVEAPIToken=${credential.tokenId}=${credential.secret}`;
