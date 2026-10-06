/**
 * `Talos.Kubeconfig` landing in OpenBao, written once at bring-up (K-talos-first-boot). Fully
 * offline: fake-process.ts fakes `bao`/`talosctl`; the fake `talosctl kubeconfig` handler writes a
 * fixture file to the temp path it was given, standing in for what the real binary would do.
 *
 * ⚠️ FIXTURES ONLY — see values.test.ts's own header for why the base64 fields are built from
 *   plain words at run time rather than written out literally.
 */
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { type FakeCall, fakeSpawner } from './fake-process.ts';
import {
  type KubeconfigAttributes,
  type KubeconfigProps,
  diffKubeconfig as diff,
  readKubeconfig as read,
  reconcileKubeconfig as reconcile,
} from './kubeconfig.ts';

const b64 = (words: string) => Buffer.from(words).toString('base64');

const fixtureKubeconfig = (marker: string) => `
apiVersion: v1
kind: Config
clusters:
  - name: hf-c1
    cluster:
      server: https://192.0.2.50:6443
      certificate-authority-data: ${b64(`not a ca ${marker}`)}
contexts:
  - name: admin@hf-c1
    context: { cluster: hf-c1, user: admin@hf-c1 }
users:
  - name: admin@hf-c1
    user:
      client-certificate-data: ${b64(`not a certificate ${marker}`)}
      client-key-data: ${b64(`not a key ${marker}`)}
current-context: admin@hf-c1
`;

const TARGET = { cluster: 'c1', mount: 'talos-c1' };
const props = (): KubeconfigProps => ({
  context: 'admin@hf-c1',
  node: '198.51.100.10',
  target: TARGET,
});

const run = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
  handler: (c: FakeCall) => { stdout?: string; stderr?: string; exitCode?: number },
  calls: FakeCall[] = [],
) =>
  Effect.runPromise(
    Effect.provideService(
      effect,
      ChildProcessSpawner.ChildProcessSpawner,
      fakeSpawner(handler, calls),
    ),
  );

describe('reconcile — CREATE writes talosctl kubeconfig output into the vault, never a host path', () => {
  it('mints the temp file, writes its content to vault via stdin, cleans up the temp file', async () => {
    const calls: FakeCall[] = [];
    let outPath = '';
    const handler = (call: FakeCall) => {
      if (call.command === 'bao' && call.args[1] === 'get') {
        return { stdout: JSON.stringify({ data: { data: { talosconfig: 'fake-talosconfig' } } }) };
      }
      if (call.command === 'bao' && call.args[1] === 'put') return {};
      if (call.command === 'talosctl' && call.args[0] === 'kubeconfig') {
        outPath = call.args[1] ?? '';
        writeFileSync(outPath, fixtureKubeconfig('create'));
        return {};
      }
      throw new Error(`unexpected call ${JSON.stringify(call)}`);
    };
    const result = (await run(
      reconcile(props(), undefined),
      handler,
      calls,
    )) as KubeconfigAttributes;

    assert.equal(result.endpoint, 'https://192.0.2.50:6443');
    assert.equal(result.context, 'admin@hf-c1');
    assert.equal(result.connection.auth.kind, 'talos-openbao');
    assert.deepEqual(result.connection.auth, {
      context: 'admin@hf-c1',
      key: 'kubeconfig',
      kind: 'talos-openbao',
      mount: 'talos-c1',
    });
    assert.equal(JSON.stringify(result).includes('talos-first-boot-unwired'), false);
    assert.equal(JSON.stringify(result).includes('BEGIN CERTIFICATE'), false);
    assert.equal(JSON.stringify(result).includes('PRIVATE KEY'), false);

    const put = calls.find((c) => c.command === 'bao' && c.args[1] === 'put');
    assert.ok(put);
    // ⛔ C2 (LAND red team): `=-`, never `=@-` — see credentials-write.ts's own header.
    assert.deepEqual(put.args, ['kv', 'put', 'talos-c1/kubeconfig', 'kubeconfig=-']);
    assert.equal(put.stdin, fixtureKubeconfig('create'));
    assert.ok(!put.args.some((a) => a.includes('not a key')), 'never in argv');

    assert.equal(existsSync(outPath), false, 'the captured temp file must be gone after reconcile');
  });
});

describe('reconcile — write-once: a second reconcile never re-runs talosctl kubeconfig', () => {
  it('confirms from the vault copy instead of minting a new admin cert', async () => {
    const calls: FakeCall[] = [];
    const priorOutput: KubeconfigAttributes = {
      certificateAuthorityFingerprint: 'x',
      clientCertificateFingerprint: 'x',
      connection: { auth: { context: 'admin@hf-c1', kind: 'kubeconfig' } },
      context: 'admin@hf-c1',
      credentialGeneration: 'x',
      endpoint: 'https://192.0.2.50:6443',
    };
    const handler = (call: FakeCall) => {
      if (call.command === 'bao' && call.args[1] === 'get') {
        return {
          stdout: JSON.stringify({ data: { data: { config: fixtureKubeconfig('confirm') } } }),
        };
      }
      throw new Error(`unexpected call ${JSON.stringify(call)}`);
    };
    const result = (await run(
      reconcile(props(), priorOutput),
      handler,
      calls,
    )) as KubeconfigAttributes;

    assert.equal(result.endpoint, 'https://192.0.2.50:6443');
    assert.ok(
      calls.every(
        (c) => !(c.command === 'talosctl') && !(c.command === 'bao' && c.args[1] === 'put'),
      ),
      'a confirm-only reconcile never spawns talosctl or writes the vault again',
    );
  });
});

describe('read — C1 fix: undefined means genuinely absent, never "some read failed"', () => {
  it('returns undefined (never a defined empty object) when the vault key was never written', async () => {
    // ⛔ MEASURED against OpenBao v2.6.2: this exit code + stderr text is exactly what `bao kv get`
    // prints for a genuinely unwritten KV-v2 key — see kubeconfig.ts's `isVaultKeyAbsent` header.
    const result = await run(read(props()), () => ({
      exitCode: 2,
      stderr: 'No value found at talos-c1/data/kubeconfig',
    }));
    assert.equal(result, undefined);
  });

  it('propagates a genuine vault/transport failure instead of reading it as absence', async () => {
    await assert.rejects(
      run(read(props()), () => ({ exitCode: 2, stderr: 'permission denied' })),
      (error: unknown) => error instanceof Error && error.message.includes('permission denied'),
    );
  });
});

describe('read → reconcile chained the way the Alchemy engine drives a cold start (C1 regression)', () => {
  it('a cold-start read (undefined) followed by reconcile(undefined) actually creates', async () => {
    // ⛔ Alchemy beta.79 Plan.ts:1303-1352 always calls `read` first when there is no state row; a
    // DEFINED result there is adopted and forces `update`, so this is the exact sequence that made
    // Talos.Kubeconfig un-creatable before the C1 fix — see kubeconfig.ts's own `readKubeconfig`
    // header.
    const calls: FakeCall[] = [];
    const coldHandler = () => ({
      exitCode: 2,
      stderr: 'No value found at talos-c1/data/kubeconfig',
    });
    const readResult = await run(read(props()), coldHandler, calls);
    assert.equal(
      readResult,
      undefined,
      "the engine's adoption probe must see a genuine cold start",
    );

    const createHandler = (call: FakeCall) => {
      if (call.command === 'bao' && call.args[1] === 'get') {
        // ★ mintTalosconfig reads the `talosconfig` key first — only the `kubeconfig` key itself
        // is genuinely absent at a cold start.
        return call.args[3]?.endsWith('/kubeconfig')
          ? coldHandler()
          : { stdout: JSON.stringify({ data: { data: { talosconfig: 'fake-talosconfig' } } }) };
      }
      if (call.command === 'bao' && call.args[1] === 'put') return {};
      if (call.command === 'talosctl' && call.args[0] === 'kubeconfig') {
        writeFileSync(call.args[1] ?? '', fixtureKubeconfig('engine-order'));
        return {};
      }
      throw new Error(`unexpected call ${JSON.stringify(call)}`);
    };
    const created = (await run(
      reconcile(props(), readResult),
      createHandler,
    )) as KubeconfigAttributes;
    assert.equal(created.endpoint, 'https://192.0.2.50:6443');
    assert.notEqual(created.credentialGeneration, '');
  });
});

describe('reconcile — belt-and-suspenders: a defined-but-empty output is treated as absent (C1)', () => {
  it('a pre-fix-shaped empty output still runs CREATE instead of failing to confirm', async () => {
    const staleEmptyOutput: KubeconfigAttributes = {
      certificateAuthorityFingerprint: '',
      clientCertificateFingerprint: '',
      connection: { auth: { context: 'admin@hf-c1', kind: 'kubeconfig' } },
      context: 'admin@hf-c1',
      credentialGeneration: '',
      endpoint: '',
    };
    const handler = (call: FakeCall) => {
      if (call.command === 'bao' && call.args[1] === 'get') {
        return { stdout: JSON.stringify({ data: { data: { talosconfig: 'x' } } }) };
      }
      if (call.command === 'bao' && call.args[1] === 'put') return {};
      if (call.command === 'talosctl' && call.args[0] === 'kubeconfig') {
        writeFileSync(call.args[1] ?? '', fixtureKubeconfig('stale-empty'));
        return {};
      }
      throw new Error(`unexpected call ${JSON.stringify(call)}`);
    };
    const result = (await run(
      reconcile(props(), staleEmptyOutput),
      handler,
    )) as KubeconfigAttributes;
    assert.notEqual(result.credentialGeneration, '');
  });
});

describe('diff', () => {
  it('plans noop when the vault copy matches state', async () => {
    const output: KubeconfigAttributes = (await run(
      reconcile(props(), undefined),
      (call: FakeCall) => {
        if (call.command === 'bao' && call.args[1] === 'get') {
          return { stdout: JSON.stringify({ data: { data: { talosconfig: 'x' } } }) };
        }
        if (call.command === 'bao' && call.args[1] === 'put') return {};
        if (call.command === 'talosctl') {
          writeFileSync(call.args[1] ?? '', fixtureKubeconfig('diff'));
          return {};
        }
        throw new Error('unexpected');
      },
    )) as KubeconfigAttributes;

    const result = await run(diff(props(), output), (call: FakeCall) =>
      call.args[1] === 'get'
        ? { stdout: JSON.stringify({ data: { data: { config: fixtureKubeconfig('diff') } } }) }
        : {},
    );
    assert.equal(result?.action, 'noop');
  });
});
