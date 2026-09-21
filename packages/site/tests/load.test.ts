/**
 * loadSite: locate by HF_SITE_FILE, read plain JSON, apply env overrides, refuse loudly.
 * Checkout (git) behaviour has its own file: tests/checkout.test.ts.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import * as Config from 'effect/Config';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { SiteError } from '../src/index.ts';
import { SITE_EXAMPLE, loadSite } from '../src/load.ts';
import { EXAMPLE_PATH, example, withPath } from './fixture.ts';

const scratch = await mkdtemp(join(tmpdir(), 'hf-site-load-'));
afterAll(() => rm(scratch, { recursive: true, force: true }));

async function refusal(promise: Promise<unknown>): Promise<SiteError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SiteError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

async function siteFile(name: string, content: unknown): Promise<string> {
  const file = join(scratch, name);
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

describe('locating the file', () => {
  test('no HF_SITE_FILE refuses, naming the example — there is no default path', async () => {
    const error = await refusal(loadSite({ env: {}, siteDev: true }));
    expect(error.code).toBe('load');
    expect(error.message).toContain('HF_SITE_FILE is not set');
    expect(error.message).toContain(SITE_EXAMPLE);
  });

  test('a blank HF_SITE_FILE is the same as none', async () => {
    expect((await refusal(loadSite({ env: { HF_SITE_FILE: '  ' }, siteDev: true }))).code).toBe(
      'load',
    );
  });

  test('a relative path resolves against cwd', async () => {
    await siteFile('rel.site.json', example());
    const loaded = await loadSite({
      env: { HF_SITE_FILE: 'rel.site.json' },
      cwd: scratch,
      siteDev: true,
    });
    expect(loaded.file).toBe(join(scratch, 'rel.site.json'));
    expect(loaded.overrides).toEqual([]);
  });

  test('a missing file names the path', async () => {
    const error = await refusal(
      loadSite({ env: { HF_SITE_FILE: join(scratch, 'nope.json') }, siteDev: true }),
    );
    expect(error.code).toBe('load');
    expect(error.message).toContain('nope.json');
  });

  test('a missing file is a load error even with the checkout guard on', async () => {
    // ★ Not "not committed": the file is read before git is asked about it.
    const error = await refusal(loadSite({ env: { HF_SITE_FILE: join(scratch, 'gone.json') } }));
    expect(error.code).toBe('load');
  });

  test('the shipped example loads', async () => {
    const { site } = await loadSite({ env: { HF_SITE_FILE: EXAMPLE_PATH }, siteDev: true });
    expect(site.kind).toBe('example');
  });
});

describe('the file is plain JSON, decoded strictly', () => {
  test('comments and trailing commas (JSONC) are refused', async () => {
    const file = await siteFile(
      'commented.json',
      '{\n  // vault label\n  "apex": "example.com",\n}',
    );
    const error = await refusal(loadSite({ env: { HF_SITE_FILE: file }, siteDev: true }));
    expect(error.code).toBe('load');
    expect(error.message).toContain('not plain JSON');
  });

  test('schema errors name their path', async () => {
    const file = await siteFile(
      'bad.json',
      withPath(example(), ['networks', 'lab'], '198.51.100.9/24'),
    );
    const error = await refusal(loadSite({ env: { HF_SITE_FILE: file }, siteDev: true }));
    expect(error.code).toBe('decode');
    expect(error.issues.some((l) => l.startsWith('networks.lab:'))).toBe(true);
  });

  test('a derive-version mismatch refuses', async () => {
    const error = await refusal(
      loadSite({ env: { HF_SITE_FILE: EXAMPLE_PATH }, siteDev: true, installed: '9.9.9' }),
    );
    expect(error.code).toBe('derive-version');
  });
});

describe('environment overrides', () => {
  test('an accepted override applies and is REPORTED', async () => {
    const loaded = await loadSite({
      env: { HF_SITE_FILE: EXAMPLE_PATH, HF_SITE_APEX: 'example.net', HF_TOKEN: 'not-ours' },
      siteDev: true,
    });
    expect(loaded.site.apex).toBe('example.net');
    expect(loaded.site.networks).toEqual(example()['networks'] as Record<string, string>);
    expect(loaded.overrides).toEqual(['HF_SITE_APEX']);
  });

  test('an invalid override names the variable and the path', async () => {
    const error = await refusal(
      loadSite({ env: { HF_SITE_FILE: EXAMPLE_PATH, HF_SITE_VAULT_PORT: 'abc' }, siteDev: true }),
    );
    expect(error.code).toBe('override');
    expect(error.issues[0]).toStartWith('HF_SITE_VAULT_PORT (vault.port): ');
  });

  test('guard fields and collections are refused, all at once', async () => {
    const error = await refusal(
      loadSite({
        env: {
          HF_SITE_FILE: EXAMPLE_PATH,
          HF_SITE_KIND: 'live',
          HF_SITE_VAULT_CLUSTER_NAME: 'x',
          HF_SITE_VAULT_NAMESPACE: 'other',
          HF_SITE_NETWORKS_MGMT: '192.0.2.0/24',
        },
        siteDev: true,
      }),
    );
    expect(error.code).toBe('override');
    expect(error.issues.map((l) => l.split(':')[0])).toEqual([
      'HF_SITE_KIND',
      'HF_SITE_NETWORKS_MGMT',
      'HF_SITE_VAULT_CLUSTER_NAME',
      'HF_SITE_VAULT_NAMESPACE',
    ]);
  });

  test('an override cannot rescue a broken file', async () => {
    // ★ The file decodes ALONE first. A bad apex in the file is refused even though
    //   HF_SITE_APEX would have replaced it.
    const file = await siteFile('bad-apex.json', withPath(example(), ['apex'], 'Bad'));
    const error = await refusal(
      loadSite({ env: { HF_SITE_FILE: file, HF_SITE_APEX: 'example.net' }, siteDev: true }),
    );
    expect(error.code).toBe('decode');
  });
});

describe('MEASURED TRAP: nested("hf") must come before constantCase', () => {
  // ⚠️ Measured 2026-09-21 on effect 4.0.0-rc.115, and kept as a test so an effect bump
  //   that changes either behaviour fails HERE rather than silently in a consumer's plan.
  const S = Schema.Struct({ apex: Schema.String });
  const parse = (env: Record<string, string>, order: 'nested-first' | 'case-first') => {
    const base = ConfigProvider.fromEnv({ env });
    const provider =
      order === 'nested-first'
        ? base.pipe(ConfigProvider.nested('hf'), ConfigProvider.constantCase)
        : base.pipe(ConfigProvider.constantCase, ConfigProvider.nested('hf'));
    const file = ConfigProvider.fromUnknown({ site: { apex: 'from-file' } });
    return Effect.runSync(Config.schema(S, 'site').parse(ConfigProvider.orElse(provider, file)));
  };

  test('nested first: HF_SITE_APEX is read', () => {
    expect(parse({ HF_SITE_APEX: 'from-env' }, 'nested-first').apex).toBe('from-env');
  });

  test('constantCase first: HF_SITE_APEX is IGNORED, silently', () => {
    expect(parse({ HF_SITE_APEX: 'from-env' }, 'case-first').apex).toBe('from-file');
    // …because the provider is really looking for a lower-case prefix:
    expect(parse({ hf_SITE_APEX: 'from-env' }, 'case-first').apex).toBe('from-env');
  });
});
