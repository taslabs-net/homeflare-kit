/**
 * `Grafana.MuteTiming` against a fake Grafana — the widened-type `provenance`/`version` read (see
 * the file's own header for why the SDK's declared `MuteTimeInterval` type undersells the runtime
 * value), the foreign-provenance refusal, and opaque time-interval passthrough (weekdays/times
 * fields the SDK's own `TimeInterval` type does not model either). Mirrors `contact-point.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { GrafanaProvisionedObjectError } from './alerting-provenance.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { spec } from './mute-timing.ts';
import { grafanaOperations } from './resource.ts';

const PATH = '/api/v1/provisioning/mute-timings/weekends';
const LIST_PATH = '/api/v1/provisioning/mute-timings';

const timeIntervals = [
  { times: [{ end_time: '09:00', start_time: '17:00' }], weekdays: ['friday'] },
];

const liveJson = {
  name: 'weekends',
  provenance: 'api',
  time_intervals: timeIntervals,
  version: 'v1',
};
const props = { name: 'weekends', timeIntervals };

describe('spec.fetchLive', () => {
  test('provenance and the real weekday/time fields survive decode despite the SDK type', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH ? Response.json(liveJson) : fakeFailure(404, 'x'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      name: 'weekends',
      provenance: 'api',
      timeIntervals,
    });
    expect(fake.bodies[0]).toBeUndefined();
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeGrafana(() => fakeFailure(404, 'mute timing not found'));
    const result = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });

  test('a 403 propagates — never folded to absent', async () => {
    const fake = fakeGrafana(() => fakeFailure(403, 'forbidden'));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Forbidden');
  });
});

describe('create', () => {
  test('sends the real weekday/time fields on the wire — not dropped by the SDK type either', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'POST' && url.pathname === LIST_PATH
        ? Response.json(liveJson)
        : fakeFailure(404, 'x'),
    );
    await Effect.runPromise(spec.create(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))));
    expect(fake.bodies[0]).toEqual({ name: 'weekends', time_intervals: timeIntervals });
  });
});

describe('subset-match array rule — pinned, not re-measured live', () => {
  // ⛔ FLAGGED BY AN ADVERSARIAL REVIEW OF THIS PR: `subset-match.ts`'s array comparison is exact
  //   length, then element-wise — unverified against a real Grafana instance for whether it ever
  //   pads or appends a default entry to `time_intervals` (no live mute timing exists in this house
  //   to observe). This test pins TODAY's behavior — a live observation that finds Grafana doing so
  //   would make this test itself the place to change, not a surprise discovered elsewhere.
  test('live carrying one extra time-interval entry the declaration never mentioned still shows update', async () => {
    const extraEntry = {
      ...liveJson,
      time_intervals: [...timeIntervals, { weekdays: ['sunday'] }],
    };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH ? Response.json(extraEntry) : fakeFailure(500, 'x'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    const attrs = live !== undefined ? spec.attributes(live, props) : undefined;
    expect(attrs !== undefined && spec.matches(attrs, props)).toBe(false);
  });
});

describe('reconcile — adopt semantics', () => {
  test('declaring exactly what is live is a noop: no write is ever sent', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'reconcile should not write when nothing changed'),
    );
    const after = await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(after.name).toBe('weekends');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });
});

describe('foreign provenance refuses update and destroy', () => {
  test('a file-provisioned mute timing refuses update and sends no PUT', async () => {
    const fileProvisioned = { ...liveJson, provenance: 'file' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(fileProvisioned)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const changed = { name: 'weekends', timeIntervals: [{ weekdays: ['saturday'] }] };
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile(changed)
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('a file-provisioned mute timing refuses destroy and sends no DELETE', async () => {
    const fileProvisioned = { ...liveJson, provenance: 'file' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(fileProvisioned)
        : fakeFailure(500, 'no DELETE should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .destroy(props)
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(fake.seen).toEqual([{ method: 'GET', path: PATH }]);
  });

  test('deletes a live, api-provenance mute timing, sending its version for concurrency', async () => {
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(liveJson);
      if (method === 'DELETE' && url.pathname === PATH) return Response.json({});
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .destroy(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    const del = fake.seen.findIndex((s) => s.method === 'DELETE');
    expect(del).toBeGreaterThanOrEqual(0);
    expect(fake.seen[del]?.path).toBe(`${PATH}?version=v1`);
  });
});

describe('missing provenance fails closed', () => {
  // ⛔ THE REGRESSION AN ADVERSARIAL REVIEW OF THIS PR FOUND — see contact-point.test.ts's own
  //   copy of this block for the full account. This resource is the one where it matters most:
  //   `provenance` isn't even in the SDK's declared `MuteTimeInterval` type, so "the field is
  //   missing" is a real, plausible shape for a response to take, not a hypothetical.
  const noProvenanceField: Record<string, unknown> = { ...liveJson };
  delete noProvenanceField.provenance;

  test('a response with no provenance field at all refuses update', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(noProvenanceField)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const changed = { name: 'weekends', timeIntervals: [{ weekdays: ['saturday'] }] };
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile(changed)
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(failure.message).toContain('did not report a provenance');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('a response with no provenance field at all refuses destroy', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(noProvenanceField)
        : fakeFailure(500, 'no DELETE should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .destroy(props)
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(fake.seen).toEqual([{ method: 'GET', path: PATH }]);
  });

  test('an EXPLICIT empty-string provenance (ProvenanceNone) is writable', async () => {
    const explicitlyNone = { ...liveJson, provenance: '' };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(explicitlyNone);
      if (method === 'PUT' && url.pathname === PATH) return Response.json(explicitlyNone);
      return fakeFailure(500, 'unexpected request');
    });
    const changed = { name: 'weekends', timeIntervals: [{ weekdays: ['saturday'] }] };
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile(changed)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen.some((s) => s.method === 'PUT')).toBe(true);
  });
});
