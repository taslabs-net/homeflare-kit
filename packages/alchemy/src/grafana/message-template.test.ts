/**
 * `Grafana.MessageTemplate` against a fake Grafana — the PUT-is-both-create-and-update route (no
 * `routePostTemplate` exists), the foreign-provenance refusal, and version-carrying updates.
 * Mirrors `message-template.ts`'s own file header.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { GrafanaProvisionedObjectError } from './alerting-provenance.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { spec } from './message-template.ts';
import { grafanaOperations } from './resource.ts';

const PATH = '/api/v1/provisioning/templates/slack-body';

const liveJson = {
  name: 'slack-body',
  provenance: 'api',
  template: '{{ define "slack-body" }}…{{ end }}',
  version: '3',
};
const props = { name: 'slack-body', template: '{{ define "slack-body" }}…{{ end }}' };

describe('spec.fetchLive', () => {
  test('a live template decodes into typed attributes', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH ? Response.json(liveJson) : fakeFailure(404, 'x'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      name: 'slack-body',
      provenance: 'api',
      template: '{{ define "slack-body" }}…{{ end }}',
    });
    expect(fake.bodies[0]).toBeUndefined();
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeGrafana(() => fakeFailure(404, 'template not found'));
    const result = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });

  test('a 401 propagates — never folded to absent', async () => {
    const fake = fakeGrafana(() => fakeFailure(401, 'bad token'));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Unauthorized');
  });
});

describe('create and update — the same PUT route', () => {
  test('create sends no version — nothing has been read yet', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'PUT' && url.pathname === PATH ? Response.json(liveJson) : fakeFailure(404, 'x'),
    );
    await Effect.runPromise(spec.create(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))));
    // ⛔ `name` is a URL path label (`/templates/{name}`), never part of the body — only
    //   `template` (and, on update, `version`) travel in the JSON payload.
    expect(fake.bodies[0]).toEqual({ template: props.template });
  });

  test('an api-provenance template updates and sends the live version for concurrency', async () => {
    const changed = { name: 'slack-body', template: 'v2' };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(liveJson);
      if (method === 'PUT' && url.pathname === PATH)
        return Response.json({ ...liveJson, template: 'v2' });
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile(changed)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    const put = fake.seen.findIndex((s) => s.method === 'PUT');
    expect(fake.bodies[put]).toEqual({ template: 'v2', version: '3' });
  });

  test('reconcile is a noop when the declared template already matches what is live', async () => {
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
    expect(after.name).toBe('slack-body');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });
});

describe('foreign provenance refuses update and destroy', () => {
  test('a file-provisioned template refuses update and sends no PUT', async () => {
    const fileProvisioned = { ...liveJson, provenance: 'file' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(fileProvisioned)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ name: 'slack-body', template: 'v2' })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('a file-provisioned template refuses destroy and sends no DELETE', async () => {
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

  test('deletes a live, api-provenance template', async () => {
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
    expect(fake.seen).toEqual([
      { method: 'GET', path: PATH },
      { method: 'DELETE', path: PATH },
    ]);
  });
});

describe('missing provenance fails closed', () => {
  // ⛔ THE REGRESSION AN ADVERSARIAL REVIEW OF THIS PR FOUND — see contact-point.test.ts's own
  //   copy of this block for the full account.
  const noProvenanceField: Record<string, unknown> = { ...liveJson };
  delete noProvenanceField.provenance;

  test('a response with no provenance field at all refuses update', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(noProvenanceField)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ name: 'slack-body', template: 'v2' })
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
      if (method === 'PUT' && url.pathname === PATH) {
        return Response.json({ ...explicitlyNone, template: 'v2' });
      }
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile({ name: 'slack-body', template: 'v2' })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen.some((s) => s.method === 'PUT')).toBe(true);
  });
});
