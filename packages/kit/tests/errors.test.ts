import { describe, expect, test } from 'bun:test';
import { KIND_DESCRIPTIONS, KitError, kindForStatus, type ErrorKind } from '../src/errors.ts';

describe('kindForStatus', () => {
  // 🔴 THE MAPPING THAT WAS WRONG, measured 2026-09-07: a 429 landed as a kind whose
  //   remedy says "fix your arguments", so a throttled caller rewrote a correct call.
  test('429 is rate_limited, never an argument problem', () => {
    expect(kindForStatus(429)).toBe('rate_limited');
  });

  test.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [404, 'upstream_rejected'],
    [422, 'upstream_rejected'],
    [500, 'upstream_unreachable'],
    [503, 'upstream_unreachable'],
  ])('%i maps to %s', (status, kind) => {
    expect(kindForStatus(status)).toBe(kind as ErrorKind);
  });
});

describe('KitError', () => {
  test('names the system in the message, so "request failed" is impossible', () => {
    const error = new KitError('forbidden', 'token lacks Grafana Read', { system: 'grafana' });

    expect(error.message).toBe('grafana: token lacks Grafana Read');
    expect(error.system).toBe('grafana');
  });

  test('retryable only where retrying unchanged could work', () => {
    const rate = new KitError('rate_limited', 'slow down', { system: 's', retryAfterMs: 1000 });
    const forbidden = new KitError('forbidden', 'no grant', { system: 's' });

    expect(rate.retryable).toBe(true);
    // ⛔ Retrying a forbidden call forever is the exact agent failure this prevents.
    expect(forbidden.retryable).toBe(false);
  });

  test('carries a remedy, which is what stops an agent looping', () => {
    const error = new KitError('misconfigured', 'no URL set', {
      system: 'netbox',
      remedy: 'set NETBOX_URL',
    });

    expect(error.remedy).toBe('set NETBOX_URL');
  });

  test('every kind is described — a missing case would be a compile error', () => {
    for (const [kind, text] of Object.entries(KIND_DESCRIPTIONS)) {
      expect(text.length).toBeGreaterThan(10);
      expect(kind).toBeTruthy();
    }
  });
});
