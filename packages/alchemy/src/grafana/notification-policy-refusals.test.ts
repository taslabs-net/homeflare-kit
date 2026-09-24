/**
 * `Grafana.NotificationPolicy`'s two refusal/gate mechanisms: the foreign-provenance refusal on
 * `update` (explicit foreign, missing, and explicit-none-is-writable — the same fail-closed rule
 * kit PR 250's adversarial review established) and the `allowReset` gate on `destroy` (never calls
 * `routeResetPolicyTree` without it, regardless of Alchemy's own removal policy). Split out of
 * `notification-policy.test.ts` to keep each file under the house's 250-line cap.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { GrafanaProvisionedObjectError } from './alerting-provenance.ts';
import { PATH, liveTree, props } from './notification-policy-fixtures.ts';
import { spec } from './notification-policy.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { grafanaOperations } from './resource.ts';

describe('foreign provenance refuses update', () => {
  test('a file-provisioned tree refuses update and sends no PUT', async () => {
    const fileProvisioned = { ...liveTree, provenance: 'file' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(fileProvisioned)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ route: { ...props.route, receiver: 'other' } })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(failure.message).toContain('file');
  });

  test('a response with no provenance field at all refuses update', async () => {
    const noProvenance: Record<string, unknown> = { ...liveTree };
    delete noProvenance.provenance;
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(noProvenance)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ route: { ...props.route, receiver: 'other' } })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(failure.message).toContain('did not report a provenance');
  });

  test('an EXPLICIT empty-string provenance (ProvenanceNone) is writable', async () => {
    const explicitlyNone = { ...liveTree, provenance: '' };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(explicitlyNone);
      if (method === 'PUT' && url.pathname === PATH) return Response.json(explicitlyNone);
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile({ route: { ...props.route, receiver: 'other' } })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen.some((s) => s.method === 'PUT')).toBe(true);
  });
});

describe('destroy never resets without allowReset', () => {
  test('destroy without allowReset sends no DELETE — retained, not reset', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(liveTree)
        : fakeFailure(500, 'no DELETE should be attempted'),
    );
    await Effect.runPromise(
      grafanaOperations(spec)
        .destroy(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen).toEqual([{ method: 'GET', path: PATH }]);
  });

  test('destroy with allowReset: true calls routeResetPolicyTree', async () => {
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(liveTree);
      if (method === 'DELETE' && url.pathname === PATH) return Response.json({});
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .destroy({ ...props, allowReset: true })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen).toEqual([
      { method: 'GET', path: PATH },
      { method: 'DELETE', path: PATH },
    ]);
  });

  test('a foreign-provenance tree refuses destroy even with allowReset: true', async () => {
    const fileProvisioned = { ...liveTree, provenance: 'file' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(fileProvisioned)
        : fakeFailure(500, 'no DELETE should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .destroy({ ...props, allowReset: true })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(fake.seen).toEqual([{ method: 'GET', path: PATH }]);
  });
});
