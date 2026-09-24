/**
 * The SDK shares Bao's existing call-time environment and process-wide concurrency gate.
 * Merely supplying HttpClient does not apply that gate: legacy calls acquire it in baoCall.
 * ⛔ No automatic SDK retries: an interrupted write may already have reached the vault.
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
 * Only read operations use the existing two transport retries (750 ms between attempts).
 * Each attempt reacquires the shared permit and its own bounded timeout. Typed SDK status
 * and decoding failures still propagate immediately; uncertain writes are never replayed.
 */
export const runBaoRead = <A, E>(
  operation: Effect.Effect<A, E, OpenBaoOpContext>,
  timeout: Duration.Input = BAO_TIMEOUT,
): Effect.Effect<A, E | BaoError | Cause.TimeoutError, HttpClient.HttpClient> =>
  retryTransport(runBao(operation, timeout));
