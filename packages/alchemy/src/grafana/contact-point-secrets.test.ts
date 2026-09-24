/**
 * `Grafana.ContactPoint`'s `secureSettingsRefs` seam (S25) — split out of `contact-point.test.ts`
 * to keep each file under the house's 250-line cap. A secret value must reach the wire on write and
 * never appear anywhere this resource returns or would persist.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { LIST_PATH, liveJson, props } from './contact-point-fixtures.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { grafanaOperations } from './resource.ts';
import { GrafanaSecretRefUnsetError, spec } from './contact-point.ts';

const ENV_VAR = 'GRAFANA_FAMILY_TEST_CP_TOKEN';

describe('secure settings references (S25)', () => {
  test('create resolves the env var fresh and merges it into settings, never as a prop', async () => {
    process.env[ENV_VAR] = 'xoxb-s3cret';
    try {
      const fake = fakeGrafana((method, url) =>
        method === 'POST' && url.pathname === LIST_PATH
          ? Response.json(liveJson)
          : fakeFailure(404, 'x'),
      );
      await Effect.runPromise(
        spec
          .create({ ...props, secureSettingsRefs: { url: ENV_VAR } })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      );
      expect(fake.bodies[0]).toMatchObject({
        settings: { recipient: '#oncall', url: 'xoxb-s3cret' },
      });
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test('the secret reaches the wire on create but never the RETURNED attributes — proven end to end', async () => {
    // ⛔ THE POINT OF THIS FAMILY'S TESTS, TIGHTENED AFTER AN ADVERSARIAL REVIEW OF THIS PR: the
    //   earlier version only asserted `JSON.stringify(props)` never contained the secret — trivially
    //   true, since `props` never held it to begin with (it lives in `secureSettingsRefs`, an env
    //   var NAME). This drives a REAL `reconcile` (create, then the read-back `resource.ts` always
    //   does) through the fake and stringifies what it actually RETURNS — the shape that would be
    //   persisted to state — proving the secret never survives there, not just that it was never in
    //   an input we already knew was secret-free.
    process.env[ENV_VAR] = 'xoxb-s3cret';
    try {
      let created = false;
      const fake = fakeGrafana((method, url) => {
        if (method === 'GET' && url.pathname === LIST_PATH) {
          return created
            ? Response.json([
                { ...liveJson, settings: { recipient: '#oncall', url: 'RedactedValue' } },
              ])
            : Response.json([]);
        }
        if (method === 'POST' && url.pathname === LIST_PATH) {
          created = true;
          return Response.json(liveJson);
        }
        return fakeFailure(500, 'unexpected request');
      });
      const declared = { ...props, secureSettingsRefs: { url: ENV_VAR } };
      const attrs = await Effect.runPromise(
        grafanaOperations(spec)
          .reconcile(declared)
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      );
      const createBody = fake.bodies[fake.seen.findIndex((s) => s.method === 'POST')];
      // The wire genuinely carried it — the write would be useless otherwise.
      expect(createBody).toMatchObject({ settings: { recipient: '#oncall', url: 'xoxb-s3cret' } });
      // Nothing this resource returns or would persist does — the declaration, and the attributes
      // `reconcile` hands back after reading the object right back through Grafana's own redaction.
      expect(JSON.stringify(declared)).not.toContain('xoxb-s3cret');
      expect(JSON.stringify(attrs)).not.toContain('xoxb-s3cret');
      expect(attrs.settings).toEqual({ recipient: '#oncall', url: 'RedactedValue' });
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test('create refuses with a typed error when the ref is unset — and sends nothing', async () => {
    const fake = fakeGrafana(() => fakeFailure(500, 'should not be reached'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec
          .create({ ...props, secureSettingsRefs: { url: 'DEFINITELY_UNSET_VAR_XYZ' } })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaSecretRefUnsetError);
    expect(fake.seen).toEqual([]);
  });

  test('a redacted secure field on read never fails matches, even if props still names a stale value', async () => {
    // ⛔ THE POINT: `settings.url` is declared here (a stale placeholder — the real value comes
    //   from `secureSettingsRefs` instead) specifically so a plain subset-match tolerance (live
    //   simply carrying an UNDECLARED extra key) is not what makes this pass — `nonSecretSettings`
    //   must actively exclude a key `secureSettingsRefs` names, even when `settings` also mentions
    //   it, or a redacted live value would show a permanent false `update`.
    const declared = {
      ...props,
      secureSettingsRefs: { url: 'IRRELEVANT' },
      settings: { recipient: '#oncall', url: 'https://placeholder.invalid' },
    };
    const redactedLive = { ...liveJson, settings: { recipient: '#oncall', url: 'RedactedValue' } };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json([redactedLive])
        : fakeFailure(500, 'x'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(declared).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    const attrs = live !== undefined ? spec.attributes(live, props) : undefined;
    expect(attrs !== undefined && spec.matches(attrs, declared)).toBe(true);
  });
});
