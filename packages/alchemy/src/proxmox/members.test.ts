/**
 * Which transport failures prove a request never left this machine: the rule that decides whether
 * a WRITE may go on to a second cluster member.
 *
 * ⛔ BOTH DIRECTIONS ARE PINNED. Too narrow and a write never fails over (Bun's refusal code was
 *   missing from the first draft); too wide and a write that already landed is sent to a second
 *   node (the first draft also trusted message text that mentions TLS).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Cause from 'effect/Cause';
import * as HttpClientError from 'effect/unstable/http/HttpClientError';
import { isPreSendTransport, isTransportFailure } from './members.ts';

const transport = (cause: Error) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      cause,
      request: { method: 'PUT', url: 'https://node-b.mgmt.example.com:8006/api2/json/x' } as never,
    }),
  });

const coded = (code: string, message = 'transport') => Object.assign(new Error(message), { code });

describe('transport classification', () => {
  it('treats timeout TransportError as transport but not pre-send', () => {
    const timeout = transport(coded('AbortError', 'aborted'));
    assert.equal(isTransportFailure(timeout), true);
    assert.equal(isPreSendTransport(timeout), false);
  });

  // ★ Bun's spelling first — MEASURED 2026-09-14 through FetchHttpClient; see members.ts.
  it('treats refused, unresolvable and refused-certificate as pre-send', () => {
    for (const code of [
      'ConnectionRefused',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ]) {
      assert.equal(isPreSendTransport(transport(coded(code))), true, code);
    }
  });

  // ⛔ A message that merely mentions TLS proves nothing about whether a write was sent.
  it('never takes message text, a mid-stream TLS error or a reset as proof of pre-send', () => {
    assert.equal(isPreSendTransport(transport(new Error('TLS connection closed by peer'))), false);
    assert.equal(isPreSendTransport(transport(coded('ERR_SSL_DECRYPTION_FAILED'))), false);
    assert.equal(isPreSendTransport(transport(coded('ECONNRESET'))), false);
  });

  it('never treats an HTTP answer as a transport failure', () => {
    assert.equal(isTransportFailure(new Error('500')), false);
    assert.equal(isPreSendTransport(new Error('ConnectionRefused')), false);
  });

  // ★ `MEMBER_TIMEOUT` produces this via `Effect.timeout` — see members-timeout.test.ts for the
  //   live-server proof that it actually fires and bounds a hung attempt.
  it('treats a bounded-attempt timeout as transport for a read, never pre-send for a write', () => {
    const timedOut = new Cause.TimeoutError();
    assert.equal(isTransportFailure(timedOut), true);
    assert.equal(isPreSendTransport(timedOut), false);
  });
});
