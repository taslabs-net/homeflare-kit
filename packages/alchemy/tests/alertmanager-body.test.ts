/**
 * The Alertmanager webhook body, RENDERED — not just read — and checked against the shape
 * `POST /api/v2/alerts` accepts.
 *
 * ★ RENDERED WITH handlebars.js, SET UP THE WAY proxmox-notify SETS UP ITS OWN: no HTML escaping,
 *   and exactly three helpers with the Rust semantics (endpoints/webhook.rs, read at HEAD
 *   2026-09-22) — `json` is `serde_json::to_string` of the value (a MISSING value is `null`),
 *   `escape` is that minus the quotes and THROWS on a non-string, `url-encode` percent-encodes.
 * ⚠️ WHAT THIS CANNOT PROVE: handlebars.js is not handlebars-rust. The constructs the template uses
 *   — `{{#if path}}`, a helper with one path argument, `fields.job-id` — exist in both, and a
 *   scratch build of handlebars-rust 5.1.2 with the three helpers restated rendered these same
 *   three events to valid JSON (2026-09-22, not kept in CI: it needs a Rust toolchain). The first
 *   real notification is still the measurement; the PBS UI's "Test" button sends one.
 *
 * ★ THE EVENTS ARE PBS'S OWN (src/server/notifications/mod.rs at HEAD): GC has no `job-id`, a
 *   verify job's `type` is `verify`, and the test notification has no fields at all.
 */
import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import { alertmanagerAlertBody } from '../src/proxmox/alertmanager-body.ts';

const renderer = Handlebars.create();
renderer.registerHelper('json', (value: unknown) => JSON.stringify(value ?? null));
renderer.registerHelper('escape', (value: unknown) => {
  if (typeof value !== 'string') throw new Error('escape: param 0 not found');
  return JSON.stringify(value).slice(1, -1);
});
renderer.registerHelper('url-encode', (value: unknown) => encodeURIComponent(String(value)));

interface Notification {
  readonly severity: string;
  readonly title: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, string>>;
}

const render = (body: string, n: Notification): unknown =>
  JSON.parse(
    renderer.compile(body, { noEscape: true, strict: false })({
      ...n,
      secrets: {},
      timestamp: 1_758_500_000,
    }),
  );

const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ALERT_KEYS = new Set(['annotations', 'endsAt', 'generatorURL', 'labels', 'startsAt']);

/** Alertmanager api/v2/openapi.yaml `postableAlerts`: an array; labels required; string maps. */
const assertPostableAlerts = (value: unknown) => {
  expect(Array.isArray(value)).toBe(true);
  for (const alert of value as Record<string, unknown>[]) {
    expect(Object.keys(alert).every((key) => ALERT_KEYS.has(key))).toBe(true);
    for (const set of ['labels', 'annotations'] as const) {
      const map = alert[set] as Record<string, unknown>;
      expect(typeof map).toBe('object');
      for (const [name, v] of Object.entries(map)) {
        if (set === 'labels') expect(name).toMatch(LABEL_NAME);
        expect(typeof v).toBe('string');
      }
    }
    expect(Object.keys(alert['labels'] as object).length).toBeGreaterThan(0);
  }
  return value as { labels: Record<string, string>; annotations: Record<string, string> }[];
};

const gcFailure: Notification = {
  fields: { datastore: 'store1', hostname: 'pbs', type: 'gc' },
  message: 'Garbage collection failed: "chunk store" is\tlocked\nsee C:\\path — ünïcode',
  severity: 'error',
  title: "Garbage Collect Datastore 'store1' failed",
};

describe('alertmanagerAlertBody renders to a valid Alertmanager v2 alert array', () => {
  test('a GC failure: no job_id, every value intact through JSON', () => {
    const [alert] = assertPostableAlerts(render(alertmanagerAlertBody(), gcFailure));
    expect(alert?.labels).toEqual({
      alertname: 'PbsNotification',
      datastore: 'store1',
      hostname: 'pbs',
      job_type: 'gc',
      severity: 'error',
      source: 'pbs',
    });
    expect(alert?.annotations['description']).toBe(gcFailure.message);
    expect(alert?.annotations['summary']).toBe(gcFailure.title);
    expect(alert?.annotations['timestamp']).toBe('1758500000');
  });

  test('a verify failure carries its job id', () => {
    const verify = {
      ...gcFailure,
      fields: { ...gcFailure.fields, 'job-id': 'v-store1', type: 'verify' },
    };
    const [alert] = assertPostableAlerts(render(alertmanagerAlertBody(), verify));
    expect(alert?.labels['job_id']).toBe('v-store1');
    expect(alert?.labels['job_type']).toBe('verify');
  });

  test("the UI's Test notification, with no fields at all, still renders valid JSON", () => {
    const blank = { fields: {}, message: 'test', severity: 'info', title: 'Test notification' };
    const [alert] = assertPostableAlerts(render(alertmanagerAlertBody(), blank));
    expect(Object.keys(alert?.labels ?? {}).sort()).toEqual(['alertname', 'severity', 'source']);
  });

  test('options: a generatorURL is added, names are replaced, template syntax is refused', () => {
    const body = alertmanagerAlertBody({
      alertname: 'PbsJobFailed',
      generatorURL: 'https://pbs.example.com:8007/',
      source: 'backup',
    });
    const [alert] = assertPostableAlerts(render(body, gcFailure)) as unknown as {
      labels: Record<string, string>;
      generatorURL: string;
    }[];
    expect(alert?.labels['alertname']).toBe('PbsJobFailed');
    expect(alert?.labels['source']).toBe('backup');
    expect(alert?.generatorURL).toBe('https://pbs.example.com:8007/');
    expect(() => alertmanagerAlertBody({ alertname: '{{ secrets.token }}' })).toThrow();
    expect(() => alertmanagerAlertBody({ source: '' })).toThrow();
  });

  test('never reaches for a field bare, and never uses `escape` (it throws on a missing field)', () => {
    const body = alertmanagerAlertBody();
    expect(body).not.toContain('escape');
    for (const line of body.split('\n').filter((l) => l.includes('fields.'))) {
      expect(line.trim()).toMatch(/^\{\{#if (fields\.[\w-]+)\}\}.*\{\{ json \1 \}\},\{\{\/if\}\}$/);
    }
  });
});
