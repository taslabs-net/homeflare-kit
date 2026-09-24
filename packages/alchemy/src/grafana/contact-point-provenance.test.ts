/**
 * `Grafana.ContactPoint`'s provenance refusal — both the explicit-foreign case (`provenance:
 * 'file'`) and the missing-field-fails-closed case an adversarial review of this PR found. Split
 * out of `contact-point.test.ts` to keep each file under the house's 250-line cap.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { GrafanaProvisionedObjectError } from './alerting-provenance.ts';
import { ITEM_PATH, LIST_PATH, liveJson, props } from './contact-point-fixtures.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { grafanaOperations } from './resource.ts';
import { spec } from './contact-point.ts';

describe('update and destroy — foreign provenance refuses', () => {
  test('a file-provisioned contact point refuses update and sends no PUT', async () => {
    const fileProvisioned = { ...liveJson, provenance: 'file' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json([fileProvisioned])
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ ...props, name: 'Renamed' })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(failure.message).toContain('file');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('a file-provisioned contact point refuses destroy and sends no DELETE', async () => {
    const fileProvisioned = { ...liveJson, provenance: 'file' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json([fileProvisioned])
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
    expect(fake.seen).toEqual([{ method: 'GET', path: LIST_PATH }]);
  });
});

describe('missing provenance fails closed', () => {
  // ⛔ THE REGRESSION AN ADVERSARIAL REVIEW OF THIS PR FOUND. An earlier version mapped
  //   `live.provenance ?? ''`, so a response that simply omitted the field looked identical to an
  //   explicit `ProvenanceNone` and was treated as writable — the guard failed OPEN. These three
  //   tests pin the fix: missing refuses (both writes), an EXPLICIT `""` is the only thing that
  //   allows one.
  const noProvenanceField: Record<string, unknown> = { ...liveJson };
  delete noProvenanceField.provenance;

  test('a response with no provenance field at all refuses update', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json([noProvenanceField])
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ ...props, name: 'Renamed' })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(failure.message).toContain('did not report a provenance');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('a response with no provenance field at all refuses destroy', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json([noProvenanceField])
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
    expect(fake.seen).toEqual([{ method: 'GET', path: LIST_PATH }]);
  });

  test('an EXPLICIT empty-string provenance (ProvenanceNone) is writable', async () => {
    const explicitlyNone = { ...liveJson, provenance: '' };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === LIST_PATH) return Response.json([explicitlyNone]);
      if (method === 'PUT' && url.pathname === ITEM_PATH) {
        return Response.json({ ...explicitlyNone, name: 'Renamed' });
      }
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile({ ...props, name: 'Renamed' })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen.some((s) => s.method === 'PUT' && s.path === ITEM_PATH)).toBe(true);
  });
});
