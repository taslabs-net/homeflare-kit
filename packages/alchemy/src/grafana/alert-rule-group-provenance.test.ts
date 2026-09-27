/**
 * `Grafana.AlertRuleGroup`'s per-rule provenance refusal — explicit-foreign (`"file"` on one
 * rule), missing (a rule whose response omits the field, failing closed the same way every other
 * resource in this family does), an EXPLICIT `""` being writable, and an empty group having
 * nothing to refuse on. Split out of `alert-rule-group.test.ts` to keep each file under the
 * house's 250-line cap.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { GrafanaProvisionedObjectError } from './alerting-provenance.ts';
import { PATH, liveJson, liveRule, props } from './alert-rule-group-fixtures.ts';
import { spec } from './alert-rule-group.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { grafanaOperations } from './resource.ts';

describe('a foreign-provenance rule refuses the whole group', () => {
  test('one file-provisioned rule among several refuses update and sends no PUT', async () => {
    const mixed = {
      ...liveJson,
      rules: [liveRule, { ...liveRule, uid: 'other', provenance: 'file' }],
    };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(mixed)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ ...props, interval: 120 })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(failure.message).toContain('file');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('a file-provisioned group refuses destroy and sends no DELETE', async () => {
    const fileProvisioned = { ...liveJson, rules: [{ ...liveRule, provenance: 'file' }] };
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
});

describe('missing provenance on a rule fails closed', () => {
  // ⛔ SAME REGRESSION AN ADVERSARIAL REVIEW OF kit PR 250 FOUND — see contact-point-provenance.
  //   test.ts's own copy of this block for the full account.
  const noProvenanceRule: Record<string, unknown> = { ...liveRule };
  delete noProvenanceRule.provenance;

  test('a response where a rule omits provenance entirely refuses update', async () => {
    const missing = { ...liveJson, rules: [noProvenanceRule] };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(missing)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ ...props, interval: 120 })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(failure.message).toContain('did not report a provenance');
  });

  test('an EXPLICIT empty-string provenance (ProvenanceNone) is writable', async () => {
    const explicitlyNone = { ...liveJson, rules: [{ ...liveRule, provenance: '' }] };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(explicitlyNone);
      if (method === 'PUT' && url.pathname === PATH) return Response.json(explicitlyNone);
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile({ ...props, interval: 120 })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen.some((s) => s.method === 'PUT')).toBe(true);
  });
});

describe('an empty live group has nothing to refuse on', () => {
  test('a group with zero rules is never foreign, and destroy proceeds', async () => {
    const empty = { ...liveJson, rules: [] };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(empty);
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
