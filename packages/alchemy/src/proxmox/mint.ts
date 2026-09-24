/**
 * Minting one PVE/PBS credential from OpenBao: `GET /v1/<mount>/creds/<role>`, alive for five
 * minutes. Split out of `credentials.ts` (2026-09-24) to keep that file's TYPES under the
 * 250-line cap once `PveCredentialDenied`'s catchers needed a real header there; the reasoning
 * for WHY the estate mints rather than stores a token is still credentials.ts's own header.
 *
 * ⛔ THE SECRET NEVER TOUCHES DISK, A LOG, OR ALCHEMY STATE — see credentials.ts's ⛔. Nothing
 *   here returns it to a resource; it is used to build a header and then dropped.
 */
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as Headers from 'effect/unstable/http/Headers';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import { PveCredentialDenied } from './credential-errors.ts';
import type { ApiTarget, BaoEnvironment, PveCredential, PveRole } from './credentials.ts';

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
      const isOpenBaoBody = Array.isArray(errors);
      const detail = isOpenBaoBody ? errors.map(String).join('; ') : 'not an OpenBao error body';
      /**
       * ⛔ 403 GETS THE TYPED TAG ONLY WITH A GENUINE OpenBao ERROR BODY — found on adversarial
       *   review 2026-09-24. Status alone is not enough: a WAF, a proxy in front of OpenBao, or an
       *   mTLS terminator can answer 403 without OpenBao ever seeing the request, and `parsed` is
       *   then `undefined`/`errors` is not an array (the `try`/`catch` above, or a body that
       *   parses but isn't OpenBao's shape). That is an infrastructure fault, not "this identity
       *   is denied this role" — tagging it `PveCredentialDenied` would fold a REAL outage into
       *   "unreadable, report noop" exactly as quietly as the bug this fix exists to remove. Only
       *   a parsed `errors` array is OpenBao's own documented error shape (mint.ts's own header),
       *   so it is the one signal trusted here.
       */
      if (status === 403 && isOpenBaoBody) {
        return yield* Effect.fail(new PveCredentialDenied({ detail, mount: target.mount, role }));
      }
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
