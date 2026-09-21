/**
 * Bao.Plugin's calls and reconcile against a fake. The parts worth pinning are the ones the source
 * read turned up: a missing entry is a real 404, a builtin answers at an unversioned name, a
 * declarative entry belongs to config, and a self-versioning binary is filed under its own version.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaoError } from './bao-status.ts';
import { type Reply, type Seen, run, runFailure, withFake } from './fake-bao.ts';
import { type BaoPluginProps, resolve } from './plugin-form.ts';
import { reconcilePlugin } from './plugin-reconcile.ts';
import { deregisterPlugin, readPluginData, registerPlugin } from './plugin-wire.ts';

const SUM = '0123456789abcdef'.repeat(4);
const UNVERSIONED: BaoPluginProps = {
  command: 'openbao-plugin-secrets-cloudflare',
  name: 'openbao-plugin-secrets-cloudflare',
  sha256: SUM,
  type: 'secret',
};
const PROPS: BaoPluginProps = { ...UNVERSIONED, version: 'v0.1.2' };
const FORM = resolve(PROPS);
const PATH = '/v1/sys/plugins/catalog/secret/openbao-plugin-secrets-cloudflare';
const ENTRY = {
  args: [],
  builtin: false,
  command: PROPS.command,
  declarative: false,
  name: PROPS.name,
  oci: false,
  sha256: SUM,
  version: 'v0.1.2',
};
const ABSENT = { json: { errors: [] }, status: 404 };
const found = (data: Record<string, unknown>) => ({ json: { data }, status: 200 });

/** A catalog that answers reads with `before` until a PUT lands, and with `after` from then on. */
const catalog = (before: Reply, after: Reply = found(ENTRY)) => {
  let registered = false;
  return (seen: Seen) => {
    if (seen.method === 'PUT') {
      registered = true;
      return { status: 204 };
    }
    return registered ? after : before;
  };
};

const writes = (seen: Seen[]) => seen.filter((entry) => entry.method !== 'GET');

describe('plugin wire', () => {
  it('reads a missing entry as absent, and a refused read as an error', async () => {
    await withFake(
      () => ABSENT,
      async (bao) => {
        assert.equal(await run({ BAO_ADDR: bao.address }, readPluginData(FORM)), undefined);
        assert.equal(bao.seen[0]?.path, `${PATH}?version=v0.1.2`);
      },
    );
    await withFake(
      () => ({ json: { errors: ['permission denied'] }, status: 403 }),
      async (bao) => {
        const error = await runFailure({ BAO_ADDR: bao.address }, readPluginData(FORM));
        assert.ok(error instanceof BaoError && error.status === 403);
      },
    );
  });

  it('registers and deregisters at the paths `bao plugin` uses', async () => {
    await withFake(
      () => ({ status: 204 }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        await run(env, registerPlugin(FORM));
        await run(env, deregisterPlugin('secret', PROPS.name, 'v0.1.2'));
        assert.deepEqual(
          bao.seen.map((seen) => [seen.method, seen.path, seen.body]),
          [
            [
              'PUT',
              PATH,
              JSON.stringify({ command: PROPS.command, sha256: SUM, version: 'v0.1.2' }),
            ],
            ['DELETE', `${PATH}?version=v0.1.2`, ''],
          ],
        );
      },
    );
  });
});

describe('reconcilePlugin', () => {
  it('registers a missing plugin and returns what it read back', async () => {
    await withFake(catalog(ABSENT), async (bao) => {
      const attributes = await run({ BAO_ADDR: bao.address }, reconcilePlugin(PROPS));
      assert.equal(attributes.version, 'v0.1.2');
      assert.equal(writes(bao.seen).length, 1);
    });
  });

  it('writes nothing when the live entry already matches', async () => {
    await withFake(catalog(found(ENTRY)), async (bao) => {
      await run({ BAO_ADDR: bao.address }, reconcilePlugin(PROPS));
      assert.equal(writes(bao.seen).length, 0);
    });
  });

  it('refuses to overwrite a declarative entry or shadow a builtin', async () => {
    const cases = [
      { live: found({ ...ENTRY, declarative: true, sha256: 'f'.repeat(64) }), props: PROPS },
      {
        live: found({ builtin: true, command: '', name: 'kv', sha256: '', version: 'v2.6.2' }),
        props: { ...UNVERSIONED, name: 'kv' },
      },
    ];
    for (const [index, { live, props }] of cases.entries()) {
      await withFake(catalog(live), async (bao) => {
        await assert.rejects(
          run({ BAO_ADDR: bao.address }, reconcilePlugin(props)),
          index === 0 ? /declarative/ : /builtin/,
        );
        assert.equal(writes(bao.seen).length, 0);
      });
    }
  });

  it('names the self-reported version when an unversioned write reads back as nothing', async () => {
    await withFake(catalog(ABSENT, ABSENT), async (bao) => {
      await assert.rejects(
        run({ BAO_ADDR: bao.address }, reconcilePlugin(UNVERSIONED)),
        /declare `version`/,
      );
      assert.equal(writes(bao.seen).length, 1);
    });
  });

  it('refuses a bad declaration before sending anything', async () => {
    await withFake(catalog(ABSENT), async (bao) => {
      await assert.rejects(
        run({ BAO_ADDR: bao.address }, reconcilePlugin({ ...PROPS, version: '0.1.2' })),
        /canonical semver/,
      );
      assert.equal(bao.seen.length, 0);
    });
  });
});
