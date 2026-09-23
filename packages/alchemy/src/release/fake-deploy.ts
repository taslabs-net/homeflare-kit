/**
 * Release.Binary and HostDirectory deployed through Alchemy's OWN Plan and Apply
 * (openbao/fake-stack.ts, in-memory state), over a fake host (linux/fake-linux-host.ts) and a fake
 * server holding the synthetic vmutils archive at its real URL. `events` is every host change and
 * request, in order; `serving = false` answers every request 404.
 *
 * ⛔ TEST-ONLY, like fake-release.ts: no provider imports it and it is not on the barrel.
 */
import { renamedFrom } from 'alchemy/Rename';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { type HostRunner, hostRunnerLayer } from '../launchd/runner.ts';
import { HostDirectory, HostDirectoryProvider } from '../linux/directory.ts';
import { fakeLinuxHost } from '../linux/fake-linux-host.ts';
import { fakeStack } from '../openbao/fake-stack.ts';
import type { ReleaseBinaryProps } from './binary-form.ts';
import { ReleaseBinary, makeReleaseBinaryProvider } from './binary.ts';
import { catalogBinary } from './catalog.ts';
import { VMALERT_REQUEST, VMUTILS_URL, bytesOf, syntheticRelease } from './fake-release.ts';

export const ROOT = '/opt/example/bin';
export const DIR = `${ROOT}/vmutils-1.151.0`;
export const PATH = `${DIR}/vmalert`;
export const THEIRS = bytesOf('#!someone else built this vmalert\n');

/** One fake host (with DIR already there when `dirExists`), one fake server, one stack. */
export const deployHarness = (dirExists: boolean) => {
  const release = syntheticRelease();
  const pins = catalogBinary(release.catalog, VMALERT_REQUEST);
  const fake = fakeLinuxHost({
    dirs: dirExists ? { [DIR]: 0, [ROOT]: 0 } : { [ROOT]: 0 },
    euid: 0,
  });
  const events: string[] = [];
  const server = { serving: true };
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
    const found = server.serving && url.toString() === VMUTILS_URL;
    const body = found ? new Blob([release.vmutils.slice()]) : null;
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(body, { status: found ? 200 : 404 })),
    );
  });
  const providers = Layer.mergeAll(makeReleaseBinaryProvider(), HostDirectoryProvider()).pipe(
    Layer.provide(
      Layer.mergeAll(hostRunnerLayer(runner), Layer.succeed(HttpClient.HttpClient, client)),
    ),
  );
  const place = (bytes: Uint8Array, mode = 0o755, kind: 'file' | 'symlink' = 'file') =>
    fake.files.set(PATH, { bytes, gid: 0, kind, mode, uid: 0 });
  /** The binary declared with the directory as a literal, so Alchemy probes it. */
  const literal = ReleaseBinary('vmalert', { ...pins, directory: DIR });
  /** The documented shape: the directory is HostDirectory's `path`, an Output at a first plan. */
  const wired = (
    id = 'vmalert',
    dirMode = 0o755,
    formerId?: string,
    more: Partial<ReleaseBinaryProps> = {},
  ) =>
    Effect.gen(function* () {
      const dir = yield* HostDirectory('dir', { mode: dirMode, path: DIR });
      const binary = ReleaseBinary(id, { ...pins, ...more, directory: dir.path });
      yield* formerId === undefined ? binary : binary.pipe(renamedFrom(formerId));
    });
  /** The directory alone: the binary's declaration removed. */
  const dirOnly = HostDirectory('dir', { mode: 0o755, path: DIR });
  const stack = fakeStack(providers, {}, 'ReleaseStack');
  return { dirOnly, events, fake, literal, place, server, stack, wired };
};
