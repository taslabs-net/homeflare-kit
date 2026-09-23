/**
 * Release.Binary through Alchemy's OWN Plan and Apply (openbao/fake-stack.ts, in-memory state), with
 * `HostDirectory` declared in front of it, over a fake host that models mkdir/rmdir
 * (linux/fake-linux-host.ts) and a fake HttpClient. No network, no real filesystem.
 *
 * ★ WHAT ONLY THE ENGINE CAN SAY. A handler test shows what `diff` answers; this shows what the
 *   engine then DOES with it, in which order: that `directory: dir.path` orders the directory
 *   first; that a version bump writes the new binary before the old one goes; that a version
 *   outside the catalog fails the plan with nothing fetched and nothing touched.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { sha256Hex } from '../launchd/job-form.ts';
import { type HostRunner, hostRunnerLayer } from '../launchd/runner.ts';
import { HostDirectory, HostDirectoryProvider } from '../linux/directory.ts';
import { fakeLinuxHost } from '../linux/fake-linux-host.ts';
import { fakeStack } from '../openbao/fake-stack.ts';
import { releaseUrl } from './binary-form.ts';
import { ReleaseBinary, makeReleaseBinaryProvider } from './binary.ts';
import { type PinnedBinary, catalogBinary, catalogDirectory } from './catalog.ts';
import {
  BINARY,
  VMALERT_REQUEST,
  VMUTILS_URL,
  bytesOf,
  gzip,
  syntheticRelease,
  tarOf,
} from './fake-release.ts';
import { VICTORIA_RELEASES } from './victoria.ts';

const ROOT = '/opt/example/bin';
const NEXT = bytesOf('#!fake vmalert 1.152.0\n');

/** vmutils 1.151.0 (synthetic, at its real URL) and a synthetic 1.152.0 beside it. */
const releases = () => {
  const current = syntheticRelease();
  const next = gzip(tarOf([{ bytes: NEXT, name: 'vmalert-prod' }]));
  const nextPins: PinnedBinary = {
    archive: {
      asset: 'vmutils-darwin-arm64-v1.152.0.tar.gz',
      repo: 'VictoriaMetrics/VictoriaMetrics',
      sha256: sha256Hex(next),
      size: next.length,
      tag: 'v1.152.0',
    },
    member: 'vmalert-prod',
    name: 'vmalert',
    sha256: sha256Hex(NEXT),
  };
  const nextUrl = releaseUrl(nextPins.archive.repo, nextPins.archive.tag, nextPins.archive.asset);
  const served: Record<string, Uint8Array> = { [VMUTILS_URL]: current.vmutils, [nextUrl]: next };
  return { current: catalogBinary(current.catalog, VMALERT_REQUEST), next: nextPins, served };
};

/** One fake host and one fake server; `events` is every host change and request, in order. */
const harness = () => {
  const { current, next, served } = releases();
  const fake = fakeLinuxHost({ dirs: { [ROOT]: 0 }, euid: 0 });
  const events: string[] = [];
  const base = fake.runner;
  const runner: HostRunner = {
    ...base,
    exec: (argv) => {
      events.push(argv.filter((arg) => arg !== '--').join(' '));
      return base.exec(argv);
    },
    removeFile: (path) => {
      events.push(`remove ${path}`);
      return base.removeFile(path);
    },
    writeFileAtomic: (path, bytes, options) => {
      events.push(`write ${path}`);
      return base.writeFileAtomic(path, bytes, options);
    },
  };
  const client = HttpClient.make((request, url) => {
    events.push(`GET ${url.toString()}`);
    const bytes = served[url.toString()];
    const body = bytes === undefined ? null : new Blob([bytes.slice()]);
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(body, { status: body ? 200 : 404 })),
    );
  });
  const providers = Layer.mergeAll(makeReleaseBinaryProvider(), HostDirectoryProvider()).pipe(
    Layer.provide(
      Layer.mergeAll(hostRunnerLayer(runner), Layer.succeed(HttpClient.HttpClient, client)),
    ),
  );
  const stack = fakeStack(providers, {}, 'ReleaseStack');
  /** The stack body: one versioned directory and the binary in it, ordered by `dir.path`. */
  const declare = (pins: PinnedBinary, version: string) =>
    Effect.gen(function* () {
      const path = catalogDirectory(ROOT, { package: 'vmutils', version });
      const dir = yield* HostDirectory(`vmutils-${version}`, { mode: 0o755, path });
      yield* ReleaseBinary('vmalert', { ...pins, directory: dir.path });
    });
  return { current, declare, events, fake, next, stack };
};

const OLD = `${ROOT}/vmutils-1.151.0`;
const NEW = `${ROOT}/vmutils-1.152.0`;

describe('through the engine', () => {
  test('a version outside the catalog fails the plan: nothing fetched, nothing touched', async () => {
    const h = harness();
    const body = Effect.gen(function* () {
      const pins = catalogBinary(VICTORIA_RELEASES, { ...VMALERT_REQUEST, version: '1.152.0' });
      yield* ReleaseBinary('vmalert', { ...pins, directory: OLD });
    });
    await expect(h.stack.deploy(body)).rejects.toThrow('vmutils 1.152.0 is not in the catalog');
    expect(h.events).toEqual([]);
  });

  test('the directory first, then one download, then the one write', async () => {
    const h = harness();
    const planned = await h.stack.deploy(h.declare(h.current, '1.151.0'));
    expect(planned).toEqual({ vmalert: 'create', 'vmutils-1.151.0': 'create' });
    expect(h.events).toEqual([`mkdir -m 755 ${OLD}`, `GET ${VMUTILS_URL}`, `write ${OLD}/vmalert`]);
    expect(h.fake.files.get(`${OLD}/vmalert`)?.bytes).toEqual(BINARY.vmalert);
  });

  test('a second deploy of the same declaration changes nothing and fetches nothing', async () => {
    const h = harness();
    await h.stack.deploy(h.declare(h.current, '1.151.0'));
    h.events.length = 0;
    await h.stack.deploy(h.declare(h.current, '1.151.0'));
    expect(h.events).toEqual([]);
  });

  test('a version bump: the new binary is written BEFORE the old one goes, then the old directory', async () => {
    const h = harness();
    await h.stack.deploy(h.declare(h.current, '1.151.0'));
    h.events.length = 0;
    const planned = await h.stack.deploy(h.declare(h.next, '1.152.0'));
    expect(planned).toEqual({
      vmalert: 'replace',
      'vmutils-1.151.0': 'delete',
      'vmutils-1.152.0': 'create',
    });
    // ★ MEASURED HERE, not reasoned from Apply.ts: create-before-delete, and the old directory
    //   only once it is empty — a job whose argv holds `vmalert.path` moves before its file goes.
    expect(h.events).toEqual([
      `mkdir -m 755 ${NEW}`,
      `GET ${releaseUrl(h.next.archive.repo, h.next.archive.tag, h.next.archive.asset)}`,
      `write ${NEW}/vmalert`,
      `remove ${OLD}/vmalert`,
      `rmdir ${OLD}`,
    ]);
    expect(h.fake.files.get(`${NEW}/vmalert`)?.bytes).toEqual(NEXT);
    expect([...h.fake.files.keys()]).toEqual([`${NEW}/vmalert`]);
  });

  test('a new pin in the SAME directory fails the plan; the installed binary is untouched', async () => {
    const h = harness();
    await h.stack.deploy(h.declare(h.current, '1.151.0'));
    h.events.length = 0;
    await expect(h.stack.deploy(h.declare(h.next, '1.151.0'))).rejects.toThrow(
      'would overwrite it in place',
    );
    // ★ Refused by diff, at plan: the directory was already created, so its path is resolved.
    expect(h.events).toEqual([]);
    expect(h.fake.files.get(`${OLD}/vmalert`)?.bytes).toEqual(BINARY.vmalert);
  });

  test('the same bytes re-pinned while the directory is updated: refused at apply, binary kept', async () => {
    const h = harness();
    const body = (mode: number, tag: string) =>
      Effect.gen(function* () {
        const dir = yield* HostDirectory('vmutils-1.151.0', { mode, path: OLD });
        const archive = { ...h.current.archive, tag };
        yield* ReleaseBinary('vmalert', { ...h.current, archive, directory: dir.path });
      });
    await h.stack.deploy(body(0o755, 'v1.151.0'));
    h.events.length = 0;
    // The directory's update leaves its path unresolved at plan, so diff cannot see the path.
    await expect(h.stack.deploy(body(0o750, 'v1.151.1'))).rejects.toThrow(
      'would overwrite it in place',
    );
    // 🔴 MEASURED 2026-09-22 with diff answering `replace` here instead of `update`: the deploy
    //   SUCCEEDED and the binary was gone — the new generation took the identical file as its own,
    //   then Phase 2 deleted the old generation at the same path (binary-diff.ts).
    expect(h.events).toEqual([`chmod 750 ${OLD}`]);
    expect(h.fake.files.get(`${OLD}/vmalert`)?.bytes).toEqual(BINARY.vmalert);
  });
});
