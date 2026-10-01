/**
 * Release.Binary through Alchemy's own Plan and Apply (openbao/fake-stack.ts) over the REAL
 * localRunner, for tests that need what a fake host cannot model: two spellings of one file, and
 * the engine's order across resources. The HTTP server is a fake serving the synthetic vmutils.
 *
 * ⛔ TEST-ONLY, like fake-release.ts: no provider imports it and it is not on the barrel. Every
 *   directory a test passes must be under its own `mkdtemp`; nothing here chooses a path.
 */
import { mkdir } from 'node:fs/promises';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { localRunner } from '../launchd/local-runner.ts';
import { hostRunnerLayer } from '../launchd/runner.ts';
import { fakeStack } from '../openbao/fake-stack.ts';
import { ReleaseBinary, makeReleaseBinaryProvider } from './binary.ts';
import { catalogBinary } from './catalog.ts';
import { BINARY, VMALERT_REQUEST, VMUTILS_URL, syntheticRelease } from './fake-release.ts';

/** vmalert's bytes as text, to compare with what a test reads off the disk. */
export const VMALERT_TEXT = new TextDecoder().decode(BINARY.vmalert);

/**
 * A directory Release.Binary accepts, whatever the process umask. The resource refuses a directory
 * its group or others may write (binary-lifecycle.ts `directoryReady`), and a bare `mkdir` asks for
 * 0777 and loses the umask's bits: 0775 under the 0002 a CT100 login shell has, so the suite
 * passed under 022 and failed six tests under 0002 (measured 2026-10-01). A umask only ever takes
 * bits away, so asking for 0755 outright can come out no wider than 0755 under any mask; the
 * directories made on the way (`recursive`) get the same mode. Every test directory goes through
 * here; the resource's refusal is right and stays as it is.
 */
export const makeBinaryDirectory = async (path: string): Promise<string> => {
  await mkdir(path, { mode: 0o755, recursive: true });
  return path;
};

/** One stack over localRunner; `deploy` takes logical id → directory; `gets` counts downloads. */
export const realEngine = () => {
  const { catalog, vmutils } = syntheticRelease();
  const gets: string[] = [];
  const client = HttpClient.make((request, url) => {
    gets.push(url.toString());
    const body = url.toString() === VMUTILS_URL ? new Blob([vmutils.slice()]) : null;
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(body, { status: body ? 200 : 404 })),
    );
  });
  const providers = makeReleaseBinaryProvider().pipe(
    Layer.provide(
      Layer.mergeAll(hostRunnerLayer(localRunner()), Layer.succeed(HttpClient.HttpClient, client)),
    ),
  );
  const stack = fakeStack(providers, {}, 'RealEngineStack');
  const pins = catalogBinary(catalog, VMALERT_REQUEST);
  const deploy = (binaries: Readonly<Record<string, string>>) =>
    stack.deploy(
      Effect.gen(function* () {
        for (const [id, directory] of Object.entries(binaries)) {
          yield* ReleaseBinary(id, { ...pins, directory });
        }
      }),
    );
  return { deploy, gets };
};
