/**
 * One call to OpenBao's HTTP API through Effect's `HttpClient` — the transport every Bao.* family
 * uses since it stopped shelling out to `bao`.
 *
 * ★ `HttpClient`, THE SAME PATTERN house/proxmox and house/forgejo USE AGAINST THEIR APIs, decided
 *   2026-09-14. It buys a typed error channel, interruption when a plan is cancelled, the runtime's
 *   tracing, and a client a test can point at a fake server — and it needs no Alchemy session, so
 *   every call here works from all four operations. (`CommandExecutor.run` was tried on Bao.Policy
 *   first and blocked read/diff: Alchemy passes a session to reconcile/delete but NOT to read/diff,
 *   Provider.ts:258-289. The ChildProcessSpawner that fixed that is gone with the CLI.)
 * ⚠️ THE STACK MUST PROVIDE `FetchHttpClient.layer`. alchemy.run.ts does, the way
 *   house/proxmox/alchemy.run.ts does.
 */
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Schedule from 'effect/Schedule';
import * as Semaphore from 'effect/Semaphore';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as Headers from 'effect/unstable/http/Headers';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import { type BaoEnvironment, headersFor, resolveAddress } from './bao-address.ts';
import { BaoError, type BaoIntent, settle } from './bao-status.ts';

/**
 * The environment a call resolves BAO_ADDR, BAO_NAMESPACE and BAO_TOKEN from — `process.env`,
 * read at call time, unless a test provides another.
 */
export const BaoEnv = Context.Reference<BaoEnvironment>('homeflare/openbao/BaoEnv', {
  defaultValue: () => process.env,
});

/**
 * ⛔ AT MOST EIGHT EXCHANGES WITH OPENBAO AT ONCE — ACROSS EVERY Bao.* FAMILY, IN ONE PROCESS.
 *
 * 🔴 MEASURED 2026-09-14 10:41: A DEPLOY OF THIS STACK TOOK OPENBAO's API OFF THE MINI. Alchemy fans
 *   resources out with a hard-coded `concurrency: "unbounded"` (alchemy Plan.ts:476, Apply.ts:259,
 *   :263, :303 — no option reaches it), and 555 Bao.CloudflareRole resources each read, diff,
 *   reconcile and read back: well over a thousand requests at one loopback listener within seconds.
 *   OpenBao logged
 *     HTTP server (listening on 127.0.0.1:8200) exited with error: set tcp
 *     127.0.0.1:8200->127.0.0.1:57974: setsockopt: invalid argument
 *   and KEPT RUNNING with 8200 closed. launchd saw a live process and restarted nothing. Everything
 *   on the mini that talks to 127.0.0.1:8200 was cut off, starting with the agent's templates, until
 *   a manual restart.
 * ★ THE LISTENER DYING IS A GO-ON-DARWIN FAILURE, NOT OURS TO FIX. Traefik lost its entrypoints the
 *   same way on darwin/arm64 (traefik issue 8841). The BURST is ours. The adoption deploy an hour
 *   earlier made the same calls and survived, so a cap narrows a race; it does not prove it closed.
 * ★ A SEMAPHORE, NOT `HttpClient.withRateLimiter`. That limits requests per window and needs a
 *   RateLimiter service. The failure is simultaneous connections, and only a cap on in-flight
 *   exchanges bounds those whatever each one's latency.
 * ⚠️ A Context.Reference SO A TEST CAN PROVIDE ITS OWN GATE. The default is built ONCE and cached on
 *   the reference (effect Context.ts:1582-1588), so every call in the process shares one gate.
 * ⚠️ EIGHT IS A CHOICE, NOT A MEASUREMENT OF WHAT THE LISTENER TOLERATES. Nothing here can find that
 *   number without re-running the failure against production.
 */
export const MAX_IN_FLIGHT = 8;

export const BaoGate = Context.Reference<Semaphore.Semaphore>('homeflare/openbao/BaoGate', {
  defaultValue: () => Semaphore.makeUnsafe(MAX_IN_FLIGHT),
});

/**
 * ⚠️ THE CLI's DEFAULT CLIENT TIMEOUT (openbao v2.6.2 api/client.go:324). A hung agent or a server
 *   that accepts and never answers would otherwise hang the plan with no line saying why.
 */
const TIMEOUT = '60 seconds';

/**
 * Mesh in front of a remote OpenBao drops connections under Alchemy's unbounded
 * fan-out. Status 0 is transport, not an OpenBao 4xx — retry twice. Measured
 * 2026-09-16 against api.v.homeflare.dev: a 585-role plan died mid-diff with
 * `no response: (no errors given)` while the vault stayed unsealed.
 */
const retryTransport = <A, R>(effect: Effect.Effect<A, BaoError, R>) =>
  Effect.retry(effect, {
    schedule: Schedule.spaced('750 millis'),
    times: 2,
    while: (error: BaoError) => error.status === 0,
  });

/**
 * ⛔ EFFECT RECORDS EVERY REQUEST HEADER ON THE CLIENT SPAN and redacts only the names in
 *   `Headers.CurrentRedactedNames` — by default authorization, cookie, set-cookie and x-api-key
 *   (effect Headers.ts:753-762; HttpClient.ts:842-849, with `TracerHeaderFilter` defaulting to
 *   true). `X-Vault-Token` is not on that list, so under any tracer the token would be exported as
 *   a span attribute. It is added for every call made here.
 */
const redactingToken = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const names = yield* Headers.CurrentRedactedNames;
    return yield* Effect.provideService(effect, Headers.CurrentRedactedNames, [
      ...names,
      'x-vault-token',
    ]);
  });

/**
 * Route the exchange over a unix socket when the address is one.
 *
 * ★ BUN's `fetch` TAKES A `unix` OPTION (bun-types globals.d.ts BunFetchRequestInit.unix), AND
 *   `FetchHttpClient.RequestInit` IS EFFECT'S DOCUMENTED WAY TO PASS FETCH OPTIONS. The fetch client
 *   spreads that service into every call (effect FetchHttpClient.ts:59-72), reading it from the
 *   CALLING fiber's context — and `layerMergedContext` merges the caller's context over the layer's
 *   (HttpClient.ts:2065-2076), so providing it around one call routes that call alone. Any defaults
 *   already provided are kept.
 * ⛔ IT ONLY WORKS ON BUN, SO ANYWHERE ELSE IT REFUSES. Node's fetch ignores `unix` and would send
 *   the request to http://localhost:80 — a silent wrong server, which is the one outcome this
 *   package exists to prevent. It also assumes the provided `HttpClient` is the fetch one.
 */
const overSocket =
  (socket: string | undefined, method: string, path: string) =>
  <A, R>(effect: Effect.Effect<A, BaoError, R>): Effect.Effect<A, BaoError, R> => {
    if (socket === undefined) return effect;
    if (typeof Bun === 'undefined') {
      return Effect.fail(
        new BaoError(0, method, path, ['a unix:// address needs Bun fetch; this is not Bun']),
      );
    }
    return Effect.flatMap(Effect.serviceOption(FetchHttpClient.RequestInit), (defaults) => {
      const init: BunFetchRequestInit = { ...Option.getOrElse(defaults, () => ({})), unix: socket };
      return Effect.provideService(effect, FetchHttpClient.RequestInit, init);
    });
  };

/** One exchange, classified. The body is the parsed JSON object, or undefined for absent / 204. */
export const baoCall = (
  intent: BaoIntent,
  method: 'DELETE' | 'GET' | 'POST' | 'PUT',
  path: string,
  body?: Readonly<Record<string, unknown>>,
) =>
  Effect.gen(function* () {
    const env = yield* BaoEnv;
    const address = resolveAddress(env);
    const client = yield* HttpClient.HttpClient;
    // ⚠️ The content type goes on `bodyText`, never in the header map: `bodyText` overwrites it.
    //   house/proxmox/src/client.ts has the scar.
    const request = HttpClientRequest.make(method)(`${address.base}/v1/${path}`).pipe(
      HttpClientRequest.setHeaders(headersFor(address, env)),
      body === undefined
        ? (self) => self
        : HttpClientRequest.bodyText(JSON.stringify(body), 'application/json'),
    );
    // ★ Status first, body read exactly once, as text — an error body is not reliably JSON.
    const exchange = client.execute(request).pipe(
      Effect.flatMap((response) =>
        Effect.map(response.text, (text) => ({ status: response.status, text })),
      ),
      Effect.timeout(TIMEOUT),
      // ⛔ `.message` ONLY: the HttpClientError message is the reason, method and URL. The error
      //   object itself holds the request, whose headers hold the token.
      Effect.mapError((cause) => new BaoError(0, method, path, [cause.message])),
    );
    // ★ THE PERMIT WRAPS THE TIMEOUT, NOT THE REVERSE: a call queued behind the gate is not yet
    //   talking to OpenBao, so its wait must not count against the 60 seconds.
    const gate = yield* BaoGate;
    const { status, text } = yield* retryTransport(
      exchange.pipe(
        overSocket(address.socket, method, path),
        redactingToken,
        Semaphore.withPermits(gate, 1),
      ),
    );
    const outcome = settle(intent, method, path, status, text);
    return 'error' in outcome ? yield* Effect.fail(outcome.error) : outcome.body;
  });

/**
 * The `data` of a read, or undefined when OpenBao says the object is ABSENT (404).
 *
 * ★ `bao read -format=json` printed this same response body; the old helper took `data` when it was
 *   an object and the whole body otherwise, and so does this.
 */
export const baoRead = (path: string) =>
  Effect.map(baoCall('read', 'GET', path), (body) => {
    if (body === undefined) return undefined;
    const data = body['data'];
    return typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : (body as Record<string, unknown>);
  });

/**
 * A write whose SUCCESS MATTERS. Any non-2xx fails, 404 included.
 *
 * ★ `PUT` IS WHAT `bao write` SENT (openbao v2.6.2 api/logical.go Write); `sys/mounts` enable and
 *   tune are `POST` in the same client (api/sys_mounts.go:57, :201).
 * ⚠️ ROLE BODIES STAY ALL-STRING ON PURPOSE. `bao write k=v` put every value in the JSON body as a
 *   string — MEASURED with `-output-curl-string`, see ssh-role-form.ts — and the form files still
 *   build exactly that body, so the server parses the same request it was always sent.
 */
export const baoWrite = (
  method: 'POST' | 'PUT',
  path: string,
  body: Readonly<Record<string, unknown>>,
) => Effect.asVoid(baoCall('write', method, path, body));

/** A delete: idempotent — already gone (404) is success — and refused (403, 5xx) is a failure. */
export const baoDelete = (path: string) => Effect.asVoid(baoCall('delete', 'DELETE', path));
