/**
 * `Release.Binary` end to end, through Alchemy's own Plan and Apply (openbao/fake-stack.ts), for a
 * synthetic archive shaped like the Prometheus family: every entry wrapped in one directory
 * (tar.ts's header comment, measured 2026-09-23). `archive.root` installs it; the same declaration
 * without `root` refuses, exactly as tar-root.test.ts shows at the reader alone.
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
import type { PinnedBinary } from './catalog.ts';
import { bytesOf, gzip, tarOf } from './fake-release.ts';

const ROOT = '/opt/example/bin';
const DIR = `${ROOT}/alertmanager-0.33.1`;
const WRAPPED = 'alertmanager-0.33.1.darwin-arm64';
const BYTES = bytesOf('#!fake alertmanager 0.33.1\n');
const ARCHIVE = gzip(
  tarOf([
    { name: `${WRAPPED}/`, type: '5' },
    { bytes: BYTES, name: `${WRAPPED}/alertmanager` },
  ]),
);
const ASSET = 'alertmanager-0.33.1.darwin-arm64.tar.gz';
const REPO = 'prometheus/alertmanager';
const TAG = 'v0.33.1';
const URL = releaseUrl(REPO, TAG, ASSET);
const PATH = `${DIR}/alertmanager`;

/** The pinned props, with or without the declared root — everything else identical. */
const pins = (root?: string): PinnedBinary => ({
  archive: {
    asset: ASSET,
    repo: REPO,
    sha256: sha256Hex(ARCHIVE),
    size: ARCHIVE.length,
    tag: TAG,
    ...(root === undefined ? {} : { root }),
  },
  member: 'alertmanager',
  name: 'alertmanager',
  sha256: sha256Hex(BYTES),
});

/** One fake host and one fake server; `events` is every host write and request, in order. */
const harness = () => {
  // ★ SEED THE PARENT, NOT `DIR` ITSELF: `HostDirectory` below creates `DIR` fresh, as
  //   plan.test.ts's harness does — a directory pre-seeded at the declared path would instead be
  //   an adoption question, which is not what this file is testing.
  const fake = fakeLinuxHost({ dirs: { [ROOT]: 0 }, euid: 0 });
  const events: string[] = [];
  const runner: HostRunner = {
    ...fake.runner,
    writeFileAtomic: (path, bytes, options) => {
      events.push(`write ${path}`);
      return fake.runner.writeFileAtomic(path, bytes, options);
    },
  };
  const client = HttpClient.make((request, url) => {
    events.push(`GET ${url.toString()}`);
    const body = url.toString() === URL ? new Blob([ARCHIVE.slice()]) : null;
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(body, { status: body ? 200 : 404 })),
    );
  });
  const providers = Layer.mergeAll(makeReleaseBinaryProvider(), HostDirectoryProvider()).pipe(
    Layer.provide(
      Layer.mergeAll(hostRunnerLayer(runner), Layer.succeed(HttpClient.HttpClient, client)),
    ),
  );
  const stack = fakeStack(providers, {}, 'RootBinaryStack');
  const declare = (binary: PinnedBinary) =>
    Effect.gen(function* () {
      const dir = yield* HostDirectory('alertmanager-dir', { mode: 0o755, path: DIR });
      yield* ReleaseBinary('alertmanager', { ...binary, directory: dir.path });
    });
  return { declare, events, fake, stack };
};

describe('a directory-wrapped archive, declared with root', () => {
  test('installs, reads back and re-hashes to the pinned member digest', async () => {
    const h = harness();
    const planned = await h.stack.deploy(h.declare(pins(WRAPPED)));
    expect(planned).toEqual({ alertmanager: 'create', 'alertmanager-dir': 'create' });
    expect(h.fake.files.get(PATH)?.bytes).toEqual(BYTES);
    expect(sha256Hex(h.fake.files.get(PATH)?.bytes ?? new Uint8Array())).toBe(sha256Hex(BYTES));
  });

  test('a second deploy of the same declaration reads the file back; nothing downloaded again', async () => {
    const h = harness();
    await h.stack.deploy(h.declare(pins(WRAPPED)));
    h.events.length = 0;
    await h.stack.deploy(h.declare(pins(WRAPPED)));
    expect(h.events).toEqual([]);
    expect(h.fake.files.get(PATH)?.bytes).toEqual(BYTES);
  });

  test('the same declaration without root refuses, writes nothing, leaves no file at the path', async () => {
    const h = harness();
    await expect(h.stack.deploy(h.declare(pins()))).rejects.toThrow('is a directory');
    expect(h.fake.files.has(PATH)).toBe(false);
  });
});

describe('pinProblems refuses an unsafe root, before any host write or network call', () => {
  test.each(['', '.', '..', 'a/b', './a'])('root %j', async (root) => {
    const h = harness();
    await expect(h.stack.deploy(h.declare(pins(root)))).rejects.toThrow('archive.root must be');
    expect(h.fake.files.has(PATH)).toBe(false);
    // ★ mkdir is not instrumented (it goes through `exec`, not `writeFileAtomic`), so HostDirectory
    //   creating DIR is expected here; nothing about ReleaseBinary's own pin is.
    expect(h.events.filter((e) => e.startsWith('GET') || e.startsWith('write'))).toEqual([]);
  });
});
