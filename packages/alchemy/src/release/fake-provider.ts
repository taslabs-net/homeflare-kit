/**
 * One Release.Binary provider over one fake host and one fake HTTP server, for the handler tests
 * beside it: `requests` counts every URL asked, `notes` every `session.note`.
 *
 * ⛔ TEST-ONLY, like fake-release.ts: no provider imports it and it is not on the barrel.
 */
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { hostRunnerLayer } from '../launchd/runner.ts';
import { ReleaseBinary, makeReleaseBinaryProvider } from './binary.ts';
import {
  VMUTILS_DIR,
  VMUTILS_URL,
  releaseHost,
  syntheticRelease,
  vmalertProps,
} from './fake-release.ts';

export const ids = { fqn: 'stack/vmalert', id: 'vmalert', instanceId: 'i-1' };
export const call = { bindings: [] as never, newBindings: [] as never, oldBindings: [] as never };
export const PATH = `${VMUTILS_DIR}/vmalert`;

export type Service = Effect.Success<typeof ReleaseBinary.Provider>;

/** One provider over one fake host and one fake HTTP server; `requests` counts every URL asked. */
export const harness = () => {
  const release = syntheticRelease();
  const VMALERT = vmalertProps(release.catalog);
  const fake = releaseHost();
  const requests: string[] = [];
  const notes: string[] = [];
  const client = HttpClient.make((request, url) => {
    requests.push(url.toString());
    const body = url.toString() === VMUTILS_URL ? new Blob([release.vmutils.slice()]) : null;
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(body, { status: body ? 200 : 404 })),
    );
  });
  const layer = makeReleaseBinaryProvider().pipe(
    Layer.provide(
      Layer.mergeAll(hostRunnerLayer(fake.runner), Layer.succeed(HttpClient.HttpClient, client)),
    ),
  );
  const session = { note: (m: string) => Effect.sync(() => void notes.push(m)) } as never;
  const run = <A>(use: (p: Service) => Effect.Effect<A, unknown>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* ReleaseBinary.Provider);
      }).pipe(Effect.provide(layer)) as Effect.Effect<A>,
    );
  const reconcile = (p: Service, news: object, output?: unknown, olds?: object) =>
    p.reconcile({
      ...ids,
      ...call,
      news: news as never,
      olds: olds as never,
      output: output as never,
      session,
    });
  return { VMALERT, fake, notes, reconcile, release, requests, run };
};

export const must = <F>(fn: F | undefined): F => {
  if (fn === undefined) throw new Error('provider has no such handler');
  return fn;
};
