/**
 * `warnOnDroppedRules` — pure logic, then wired through `diff`/`update` on a fake Grafana. Captures
 * `Effect.logWarning` with a `Logger`, the house pattern `caddy/config-format-warning.test.ts`
 * established for asserting on a warning without turning it into a refusal.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Logger from 'effect/Logger';
import { warnOnDroppedRules } from './alert-rule-group-drop-warning.ts';
import { PATH, liveJson, liveRule, props } from './alert-rule-group-fixtures.ts';
import { handlers, spec } from './alert-rule-group.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { grafanaOperations } from './resource.ts';

/** Runs `effect` and returns its result plus every `Effect.logWarning` line it emitted. */
const withWarnings = async <A>(effect: Effect.Effect<A, unknown, never>) => {
  const warnings: string[] = [];
  const collect = Logger.make((options) => {
    if (options.logLevel === 'Warn') warnings.push(String(options.message));
  });
  const value = await Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([collect]))));
  return { value, warnings };
};

describe('warnOnDroppedRules — pure', () => {
  test('logs nothing when every live rule is declared', async () => {
    const { warnings } = await withWarnings(
      warnOnDroppedRules('infra', 'default', new Set(['high-cpu']), [
        { title: 'High CPU', uid: 'high-cpu' },
      ]) as Effect.Effect<void, unknown, never>,
    );
    expect(warnings).toEqual([]);
  });

  test('names a dropped rule by title and uid', async () => {
    const { warnings } = await withWarnings(
      warnOnDroppedRules('infra', 'default', new Set(['high-cpu']), [
        { title: 'High CPU', uid: 'high-cpu' },
        { title: 'Low Disk', uid: 'low-disk' },
      ]) as Effect.Effect<void, unknown, never>,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('infra/default');
    expect(warnings[0]).toContain('REMOVES 1 rule');
    expect(warnings[0]).toContain('Low Disk (low-disk)');
    expect(warnings[0]).not.toContain('High CPU');
  });

  test('a rule with no uid at all is never named — cannot express "keep it" anyway', async () => {
    const { warnings } = await withWarnings(
      warnOnDroppedRules('infra', 'default', new Set(), [{ title: 'Mystery' }]) as Effect.Effect<
        void,
        unknown,
        never
      >,
    );
    expect(warnings).toEqual([]);
  });
});

describe('wired into diff and update', () => {
  test('diff logs the dropped-rule warning before anything is written', async () => {
    const extra = { ...liveRule, title: 'Low Disk', uid: 'low-disk' };
    const withExtra = { ...liveJson, rules: [liveRule, extra] };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(withExtra)
        : fakeFailure(500, 'diff should not write'),
    );
    const { warnings, value } = await withWarnings(
      handlers
        .diff({
          news: props,
          output: { folderUid: 'infra', group: 'default', interval: 60, rules: [] },
        })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))) as Effect.Effect<
        unknown,
        unknown,
        never
      >,
    );
    expect(value).toEqual({ action: 'update' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Low Disk (low-disk)');
  });

  test('update logs the same warning right before the PUT that would drop the rule', async () => {
    const extra = { ...liveRule, title: 'Low Disk', uid: 'low-disk' };
    const withExtra = { ...liveJson, rules: [liveRule, extra] };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(withExtra);
      if (method === 'PUT' && url.pathname === PATH) return Response.json(withExtra);
      return fakeFailure(500, 'unexpected request');
    });
    const { warnings } = await withWarnings(
      grafanaOperations(spec)
        .reconcile({ ...props, interval: 120 })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))) as Effect.Effect<
        unknown,
        unknown,
        never
      >,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Low Disk (low-disk)');
  });
});
