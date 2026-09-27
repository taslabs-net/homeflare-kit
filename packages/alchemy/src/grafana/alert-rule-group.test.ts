/**
 * `Grafana.AlertRuleGroup` against a fake Grafana — the group-not-rule unit's create/update as one
 * PUT, rule-order significance, volatile-field normalization, and the folder-doesn't-exist refusal.
 * Provenance refusal tests: `alert-rule-group-provenance.test.ts` — split to keep each file under
 * the house's 250-line cap. Mirrors `dashboard.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { PATH, liveJson, props, ruleInput } from './alert-rule-group-fixtures.ts';
import { spec } from './alert-rule-group.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { grafanaOperations } from './resource.ts';

describe('spec.fetchLive', () => {
  test('a live group decodes and normalizes into typed attributes', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH ? Response.json(liveJson) : fakeFailure(404, 'x'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      folderUid: 'infra',
      group: 'default',
      interval: 60,
      rules: [
        {
          condition: 'A',
          data: [{ refId: 'A' }],
          execErrState: 'Alerting',
          folderUID: 'infra',
          for: '5m',
          noDataState: 'NoData',
          orgID: 1,
          ruleGroup: 'default',
          title: 'High CPU',
          uid: 'high-cpu',
        },
      ],
    });
    expect(fake.bodies[0]).toBeUndefined();
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeGrafana(() => fakeFailure(404, 'rule group not found'));
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
  test('sends interval and rules with the group-derived fields filled in', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'PUT' && url.pathname === PATH ? Response.json(liveJson) : fakeFailure(404, 'x'),
    );
    await Effect.runPromise(spec.create(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))));
    expect(fake.bodies[0]).toEqual({
      folderUid: 'infra',
      interval: 60,
      rules: [{ ...ruleInput, folderUID: 'infra', orgID: 1, ruleGroup: 'default' }],
      title: 'default',
    });
  });

  test('a nonexistent target folder fails as a typed BadRequest, never silently created', async () => {
    // ⛔ THE POINT: this resource never checks folder existence itself and never calls
    //   `Grafana.Folder`'s create path — see the file header. `RoutePutAlertRuleGroupError` has no
    //   `NotFound` case; Grafana's own validation failure is a `BadRequest`, left uncaught here.
    const fake = fakeGrafana(() => fakeFailure(400, 'folder does not exist'));
    const failure = await Effect.runPromise(
      Effect.flip(spec.create(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('BadRequest');
  });
});

describe('reconcile — adopt semantics, rule order significant', () => {
  test('declaring exactly what is live is a noop despite id/updated/provenance differing', async () => {
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
    expect(after.group).toBe('default');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('two rules in a different order than live shows update — order is content, not cosmetic', async () => {
    // ⛔ live is [low-disk, high-cpu]; declared below is [high-cpu, low-disk] — the SAME two rules,
    //   reversed. A looser "declared is a set of live's rules" comparison would call this a match;
    //   subset-match's array rule (position-significant) must not.
    const secondRule = { ...ruleInput, title: 'Low Disk', uid: 'low-disk' };
    const reordered = {
      ...liveJson,
      rules: [
        { ...liveJson.rules[0], title: 'Low Disk', uid: 'low-disk' },
        { ...liveJson.rules[0] },
      ],
    };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH ? Response.json(reordered) : fakeFailure(500, 'x'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    const attrs = live !== undefined ? spec.attributes(live, props) : undefined;
    const declaredReordered = { ...props, rules: [ruleInput, secondRule] };
    expect(attrs !== undefined && spec.matches(attrs, declaredReordered)).toBe(false);
  });
});

describe('update', () => {
  test('a content change updates via the same PUT, sending only declared fields', async () => {
    const changed = { ...ruleInput, for: '10m' };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(liveJson);
      if (method === 'PUT' && url.pathname === PATH) {
        return Response.json({ ...liveJson, rules: [{ ...liveJson.rules[0], for: '10m' }] });
      }
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile({ ...props, rules: [changed] })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    const put = fake.seen.findIndex((s) => s.method === 'PUT');
    expect(fake.bodies[put]).toMatchObject({ rules: [{ for: '10m' }] });
  });
});

describe('destroy', () => {
  test('deletes a live, api-provenance group', async () => {
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
