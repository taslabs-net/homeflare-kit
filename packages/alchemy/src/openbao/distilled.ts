/**
 * The SDK shares Bao's existing call-time environment and process-wide concurrency gate.
 * Merely supplying HttpClient does not apply that gate: legacy calls acquire it in baoCall.
 * ⛔ `runBao` ITSELF NEVER RETRIES: an interrupted call may already have reached the vault, and
 * replaying a non-idempotent operation (a delete whose 404-is-success path already ran, a login,
 * a credential issuance) could repeat a side effect. `runBaoRead` and `runBaoWrite` opt specific,
 * known-idempotent call shapes back into the bounded transport retry baoCall always had.
 */
import { Credentials, normalizeBaseUrl } from '@distilled.cloud/openbao/Credentials';
import type { OpenBaoOpContext } from '@distilled.cloud/openbao/Protocol';
import * as Retry from '@distilled.cloud/openbao/Retry';
import type * as Cause from 'effect/Cause';
import type * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import * as Semaphore from 'effect/Semaphore';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { isHttpClientError } from 'effect/unstable/http/HttpClientError';
import { readBaoVariable, resolveAddress } from './bao-address.ts';
import {
  BAO_TIMEOUT,
  BaoEnv,
  BaoGate,
  overSocket,
  redactingToken,
  retryTransport,
} from './bao-http.ts';
import { BaoError } from './bao-status.ts';

export const runBao = <A, E>(
  operation: Effect.Effect<A, E, OpenBaoOpContext>,
  timeout: Duration.Input = BAO_TIMEOUT,
): Effect.Effect<A, E | BaoError | Cause.TimeoutError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const env = yield* BaoEnv;
    const address = resolveAddress(env);
    const token = readBaoVariable(env, 'BAO_TOKEN');
    const gate = yield* BaoGate;
    return yield* operation.pipe(
      Effect.provideService(
        Credentials,
        Effect.succeed({
          apiBaseUrl: normalizeBaseUrl(address.base),
          ...(address.namespace === undefined ? {} : { namespace: address.namespace }),
          ...(token === '' ? {} : { token: Redacted.make(token) }),
        }),
      ),
      Retry.none,
      // ⛔ HttpClientError holds the request, including X-Vault-Token. Trace redaction is
      // fiber-local and gone when an error is serialized later; keep only its safe message,
      // as baoCall does. SDK status/resource errors retain their original typed identity.
      Effect.mapError((cause) =>
        isHttpClientError(cause) ? new BaoError(0, 'SDK', 'operation', [cause.message]) : cause,
      ),
      // ★ A queued call has not reached the server: acquire the shared permit outside the timeout.
      Effect.timeout(timeout),
      overSocket(address.socket, 'SDK', 'operation'),
      redactingToken,
      Semaphore.withPermits(gate, 1),
    );
  });

/**
 * Reads use the existing two transport retries (750 ms between attempts). Each attempt
 * reacquires the shared permit and its own bounded timeout. Typed SDK status and decoding
 * failures still propagate immediately; a read is always safe to replay because it never
 * changes vault state.
 */
export const runBaoRead = <A, E>(
  operation: Effect.Effect<A, E, OpenBaoOpContext>,
  timeout: Duration.Input = BAO_TIMEOUT,
): Effect.Effect<A, E | BaoError | Cause.TimeoutError, HttpClient.HttpClient> =>
  retryTransport(runBao(operation, timeout));

/**
 * The pre-PR `baoCall()` retried every call, writes included; that bound was lost when the
 * distilled SDK path landed with `Retry.none` on `runBao`. Restore it for the writes where
 * replaying is safe: a FULL-REPLACE, idempotent write (an OpenBao policy PUT, an AppRole
 * write) sends the complete desired state every time, so retrying an uncertain transport
 * failure converges on the same result rather than compounding a partial change. A create
 * that mints a new identifier, or any operation whose second attempt could do something the
 * first did not, must keep calling `runBao` directly and make one attempt.
 */
export const runBaoWrite = <A, E>(
  operation: Effect.Effect<A, E, OpenBaoOpContext>,
  timeout: Duration.Input = BAO_TIMEOUT,
): Effect.Effect<A, E | BaoError | Cause.TimeoutError, HttpClient.HttpClient> =>
  retryTransport(runBao(operation, timeout));
