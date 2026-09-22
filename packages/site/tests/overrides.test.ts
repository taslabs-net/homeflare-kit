/**
 * Every accepted HF_SITE_* override changes EXACTLY its own path — and the reasons the
 * list is short, measured.
 */
import { describe, expect, test } from 'bun:test';
import * as Config from 'effect/Config';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { decodeSite } from '../src/index.ts';
import { ENV_OVERRIDES, loadSite } from '../src/load.ts';
import { GUARD_FIELDS } from '../src/overrides.ts';
import { EXAMPLE_PATH, example, readPath, withPath } from './fixture.ts';

/** A valid value, different from the example's, for each overridable path. */
const ALTERNATIVES: Readonly<Record<string, string>> = {
  HF_SITE_APEX: 'example.net',
  HF_SITE_VAULT_LABEL: 'vault',
  HF_SITE_VAULT_API_LABEL: 'edge',
  HF_SITE_VAULT_PORT: '8300',
  HF_SITE_VAULT_MESH_ADDRESS: '198.18.0.9',
  HF_SITE_VAULT_OIDC_MOUNT: 'sso',
  HF_SITE_VAULT_CLI_CALLBACK_PORT: '8251',
  HF_SITE_VAULT_LAN_HOST: 'node-a',
  HF_SITE_VAULT_LAN_PORT: '8201',
  HF_SITE_VAULT_LAN_SCHEME: 'https',
  HF_SITE_CLOUDFLARE_ACCESS_TEAM: 'other-team',
  HF_SITE_GITHUB_OWNER: 'other-org',
  HF_SITE_PATHS_ESTATE_ROOT: '/srv/example',
};

const fromFile = decodeSite(example());

describe('each accepted override', () => {
  test('has an alternative value here (a new entry needs one)', () => {
    expect(Object.keys(ALTERNATIVES).sort()).toEqual(Object.keys(ENV_OVERRIDES).sort());
  });

  for (const [name, path] of Object.entries(ENV_OVERRIDES)) {
    test(`${name} changes ${path.join('.')} and nothing else`, async () => {
      const raw = ALTERNATIVES[name] ?? '';
      const value = name.endsWith('PORT') ? Number(raw) : raw;
      expect(readPath(fromFile, path)).not.toEqual(value);

      const { site } = await loadSite({
        env: { HF_SITE_FILE: EXAMPLE_PATH, [name]: raw },
        siteDev: true,
      });
      const expected = withPath(structuredClone(fromFile) as Record<string, unknown>, path, value);
      expect(site as unknown).toEqual(expected);
    });
  }
});

describe('the list stays safe', () => {
  test('no name is another name plus _…  (it would shadow it)', () => {
    const names = Object.keys(ENV_OVERRIDES);
    for (const a of names) {
      for (const b of names) expect(b.startsWith(`${a}_`)).toBe(false);
    }
  });

  test('guard fields are never overridable', () => {
    // ⛔ The identity check compares clusterName AND namespace; either one overridable
    //   lets an exported variable move the expectation along with the client.
    expect(GUARD_FIELDS).toEqual([
      'version',
      'deriveVersion',
      'kind',
      'vault.clusterName',
      'vault.namespace',
    ]);
    const paths = Object.values(ENV_OVERRIDES).map((p) => p.join('.'));
    for (const guard of GUARD_FIELDS) expect(paths).not.toContain(guard);
  });

  test('every name is HF_SITE_ + the constant-cased path', () => {
    const constant = (s: string) => s.replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
    for (const [name, path] of Object.entries(ENV_OVERRIDES)) {
      expect(name).toBe(`HF_SITE_${path.map(constant).join('_')}`);
    }
  });
});

describe('MEASURED TRAPS that keep collections and prefix-named fields off the list', () => {
  // ⚠️ Measured 2026-09-21 on effect 4.0.0-rc.115. If an effect bump changes these, the
  //   list may be able to grow — but only after this file says so.
  const S = Schema.Struct({
    networks: Schema.Record(Schema.String, Schema.String),
    labels: Schema.Struct({ vault: Schema.String, vaultApi: Schema.String }),
  });
  const file = { networks: { mgmt: 'a', lab: 'b' }, labels: { vault: 'v', vaultApi: 'api' } };
  const parse = (env: Record<string, string>) => {
    const envProvider = ConfigProvider.fromEnv({ env }).pipe(
      ConfigProvider.nested('hf'),
      ConfigProvider.constantCase,
    );
    const provider = ConfigProvider.orElse(envProvider, ConfigProvider.fromUnknown({ site: file }));
    return Effect.runSyncExit(Config.schema(S, 'site').parse(provider));
  };

  test('a record override REPLACES the record, and upper-cases the key', () => {
    const exit = parse({ HF_SITE_NETWORKS_MGMT: 'z' });
    expect(exit._tag).toBe('Success');
    if (exit._tag === 'Success') expect(exit.value.networks).toEqual({ MGMT: 'z' });
  });

  test('HF_SITE_LABELS_VAULT_API makes labels.vault unreadable', () => {
    expect(parse({ HF_SITE_LABELS_VAULT_API: 'x' })._tag).toBe('Failure');
  });
});
