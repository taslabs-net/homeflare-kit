/**
 * C1 cluster members: ordered failover, last-good preference, transport classification.
 *
 * ★ ANY MEMBER'S :8006 API MANAGES THE WHOLE CLUSTER — PVE proxies node paths itself — so the
 *   provider reaches the cluster through whichever member is up, not through one pinned node.
 *
 * ⛔ NEVER cluster-c1.example.com: it resolves to 192.0.2.250, which nothing serves.
 */
import * as Cause from 'effect/Cause';
import type * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientError from 'effect/unstable/http/HttpClientError';
import type * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import type * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import type { PveTarget } from './credentials.ts';

export const PVE_API_PORT = 8006;

/** Strict TLS, always :8006 — each node's certificate carries its mgmt name as a SAN. */
export const pveApiBase = (member: string) => `https://${member}:${String(PVE_API_PORT)}/api2/json`;

/**
 * Bound on ONE member attempt, shared by `client.ts`'s `executeOnCluster` and
 * `distilled-pve.ts`'s `runPveWith` — both loop over `orderedMembers` and both call this file's
 * classifiers, so one constant keeps them in the same failure-mode boundary.
 *
 * ⛔ MEASURED GAP, FIXED 2026-09-24: before this, NOTHING bounded a single attempt. A member that
 *   accepted the TCP connection but never answered hung the whole call forever — the for-loop
 *   never produced a failure for `isTransportFailure`/`isPreSendTransport` to classify, so it
 *   never advanced to a healthy member. `isTimeoutCause` below existed already (written for this
 *   exact case, per its own comment: "no answer after connect") but nothing ever called
 *   `Effect.timeout` to produce one.
 * ★ TB4 (the live 3-member cluster, `homeflare-proxmox/src/target.ts`) waits at most 3× this
 *   before `PveClusterExhausted` — well under S26's ~90-second ceiling on a bounded wait.
 */
export const MEMBER_TIMEOUT: Duration.Input = '20 seconds';

/** Process-scoped last member that answered, keyed by OpenBao mount (= one PVE cluster). */
const lastGoodByMount = new Map<string, string>();

/** ⚠️ TESTS ONLY — resets sticky member choice between cases. */
export const resetLastGoodForTest = () => lastGoodByMount.clear();

export const noteGoodMember = (target: PveTarget, member: string) => {
  lastGoodByMount.set(target.mount, member);
};

/** Last-good first, then the rest in configuration order. */
export const orderedMembers = (target: PveTarget): readonly string[] => {
  const preferred = lastGoodByMount.get(target.mount);
  if (preferred === undefined || !target.members.includes(preferred)) return target.members;
  return [preferred, ...target.members.filter((member) => member !== preferred)];
};

const errorCode = (cause: unknown): string | undefined => {
  if (cause !== null && typeof cause === 'object') {
    if ('code' in cause && typeof cause.code === 'string') return cause.code;
    if ('cause' in cause) return errorCode((cause as { cause: unknown }).cause);
  }
  return undefined;
};

const isTimeoutCause = (cause: unknown): boolean => {
  const code = errorCode(cause);
  if (code === 'AbortError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return true;
  }
  return cause instanceof Error && /timed out|timeout/i.test(cause.message);
};

/**
 * Error codes that PROVE the request never left this machine.
 *
 * ★ MEASURED 2026-09-14 through Effect's FetchHttpClient on Bun 1.4. The codes are Bun's, not
 *   Node's, which made the first draft's Node-only list dead code for the commonest case:
 *     connection refused        cause.code = "ConnectionRefused"   (Node says ECONNREFUSED)
 *     name does not resolve     cause.code = "ENOTFOUND"
 *     wrong certificate name    cause.code = "ERR_TLS_CERT_ALTNAME_INVALID"
 *     no answer after connect   Effect's TimeoutError — not an HttpClientError at all
 * ⛔ CODES ONLY, NEVER MESSAGE TEXT. The first draft also matched /TLS|SSL|certificate/ in the
 *   message, and a connection that drops mid-response can mention TLS too — which would have sent a
 *   write that had already landed to a second node.
 * ⚠️ A CERTIFICATE failure is pre-send: the handshake has to finish before a byte of the request is
 *   written. A generic ERR_SSL_* is deliberately absent, because it can happen mid-stream.
 */
const PRE_SEND_CODES = new Set(['ConnectionRefused', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

const isCertificateCode = (code: string) =>
  /^(ERR_TLS_CERT_|CERT_|UNABLE_TO_VERIFY_|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED_CERT)/.test(code);

const isPreSendCause = (cause: unknown): boolean => {
  const code = errorCode(cause);
  return code !== undefined && (PRE_SEND_CODES.has(code) || isCertificateCode(code));
};

/**
 * Effect HttpClientError.reason._tag — see effect HttpClientError.ts RequestError vs ResponseError.
 * ★ TransportError | InvalidUrlError | EncodeError occur before a response exists; StatusCodeError
 *   and kin include a response. client.execute does NOT filter status, so HTTP answers are never
 *   TransportError — only the transport layer is.
 * ★ `Cause.TimeoutError` (from `MEMBER_TIMEOUT` below, via `Effect.timeout`) counts too — a read
 *   with no side effect to duplicate fails over on ANY transport failure, a hang included.
 */
export const isTransportFailure = (cause: unknown): boolean => {
  if (Cause.isTimeoutError(cause)) return true;
  if (!HttpClientError.isHttpClientError(cause)) return false;
  const tag = cause.reason._tag;
  return tag === 'TransportError' || tag === 'InvalidUrlError' || tag === 'EncodeError';
};

/**
 * Pre-send only: connection refused, DNS, a certificate refused — never a timeout after connect.
 * ⛔ `Cause.TimeoutError` (MEMBER_TIMEOUT firing) falls through to `false` here on purpose, same
 *   as any other non-`HttpClientError` cause: the request may already have reached the member, so
 *   a write must not repeat it elsewhere.
 */
export const isPreSendTransport = (cause: unknown): boolean => {
  if (!HttpClientError.isHttpClientError(cause)) return false;
  const { reason } = cause;
  if (reason._tag === 'InvalidUrlError' || reason._tag === 'EncodeError') return true;
  if (reason._tag === 'TransportError') {
    if (isTimeoutCause(reason.cause)) return false;
    return isPreSendCause(reason.cause);
  }
  return false;
};

export const describeTransport = (cause: unknown): string => {
  if (Cause.isTimeoutError(cause)) return `timed out after ${String(MEMBER_TIMEOUT)}`;
  if (HttpClientError.isHttpClientError(cause)) return cause.message;
  return String(cause);
};

export type MemberAttempt = { readonly member: string; readonly why: string };

export type PveMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Run one request against cluster members with failover.
 *
 * ⛔ A POST/PUT/DELETE WHOSE REQUEST MAY HAVE REACHED A MEMBER MUST NOT BE SENT AGAIN TO ANOTHER.
 *   Only fail over a write on a provably pre-send transport failure — connection refused, DNS or a
 *   refused certificate. A timeout after sending is NOT pre-send: fail it, never repeat it. An HTTP
 *   status of any kind, including 5xx and PVE's 596, is the answer from a live member — retrying
 *   elsewhere can repeat a write.
 *
 * ★ Reads fail over on any transport failure, including timeout — no side effect to duplicate.
 *   MEASURED 2026-09-14: full C1 plans stayed all-noop with the first member refused (127.0.0.1)
 *   and with it unresolvable (n9.invalid).
 *
 * @param timeout Bound on ONE member's attempt — defaults to `MEMBER_TIMEOUT`. A test passes a
 *   short one to prove failover happens without waiting out the real bound; production code never
 *   overrides it.
 */
export const executeOnCluster = (
  target: PveTarget,
  method: PveMethod,
  path: string,
  build: (apiBase: string) => HttpClientRequest.HttpClientRequest,
  timeout: Duration.Input = MEMBER_TIMEOUT,
): Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  {
    readonly tag: 'cluster';
    readonly method: PveMethod;
    readonly path: string;
    readonly attempts: readonly MemberAttempt[];
  },
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    /**
     * ★ `HttpClient`, NOT RAW `fetch`, BECAUSE THAT IS WHAT ALCHEMY'S OWN PROVIDERS USE. Its
     *   Hetzner provider builds on `FetchHttpClient.layer` and the `HttpClient` service
     *   (src/Hetzner/Providers.ts), and there is no bare `fetch` anywhere in its Docker,
     *   Kubernetes or GitHub providers. Going through the service rather than the global buys
     *   the things a provider actually needs: a typed error channel instead of a thrown promise,
     *   interruption when a plan is cancelled, whatever tracing the runtime has installed, and a
     *   client that can be swapped for a stub in a test without monkey-patching a global.
     *
     * ⚠️ THE REQUIREMENT IS REAL AND IT PROPAGATES. Every operation carries `HttpClient`, so every
     *   resource's Requirements type names it (PveRequirements in resource.ts) and the stack
     *   provides `FetchHttpClient.layer`. That is the cost of the above, paid once.
     */
    const client = yield* HttpClient.HttpClient;
    const isWrite = method !== 'GET';
    const attempts: MemberAttempt[] = [];
    for (const member of orderedMembers(target)) {
      const outcome = yield* client
        .execute(build(pveApiBase(member)))
        .pipe(Effect.timeout(timeout), Effect.result);
      if (Result.isSuccess(outcome)) {
        noteGoodMember(target, member);
        return outcome.success;
      }
      const why = describeTransport(outcome.failure);
      attempts.push({ member, why });
      const mayRetry = isWrite
        ? isPreSendTransport(outcome.failure)
        : isTransportFailure(outcome.failure);
      if (!mayRetry) {
        return yield* Effect.fail({ attempts, method, path, tag: 'cluster' as const });
      }
    }
    return yield* Effect.fail({ attempts, method, path, tag: 'cluster' as const });
  });
