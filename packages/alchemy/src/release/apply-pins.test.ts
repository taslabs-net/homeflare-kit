/**
 * ⛔ A PIN IS NEVER COMPUTED DURING THE DEPLOY — on a FIRST deploy too. Release.Binary through
 * Alchemy's own Plan and Apply (openbao/fake-stack.ts), with a pin wired from another resource's
 * Output: the shape of "fetch the checksum file at apply and trust what it says".
 *
 * 🔴 MEASURED 2026-09-22 (supply-chain review of PR 138): before the apply-time check, the engine
 *   never diffed this create and skipped its probe (an Output in `news`), so reconcile saw only the
 *   RESOLVED digests. The release asset and its checksum file were both swapped (the releases are
 *   mutable, victoria.ts), the Output carried the swapped digests, and the deploy installed the
 *   swapped bytes and reported them verified. binary-diff.ts refused the same declaration only
 *   from the SECOND plan on — after the wrong binary was already on the host.
 */
import { describe, expect, test } from 'bun:test';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { sha256Hex } from '../launchd/job-form.ts';
import { type HostRunner, hostRunnerLayer } from '../launchd/runner.ts';
import { HostDirectory, HostDirectoryProvider } from '../linux/directory.ts';
import { fakeLinuxHost } from '../linux/fake-linux-host.ts';
import { fakeStack } from '../openbao/fake-stack.ts';
import { ReleaseBinary, makeReleaseBinaryProvider } from './binary.ts';
import { catalogBinary } from './catalog.ts';
import {
  VMALERT_REQUEST,
  VMUTILS_URL,
  bytesOf,
  gzip,
  syntheticRelease,
  tarOf,
} from './fake-release.ts';

const ROOT = '/opt/example/bin';
const DIR = `${ROOT}/vmutils-1.151.0`;
const EVIL = bytesOf('#!swapped vmalert\n');
const SWAPPED = gzip(tarOf([{ bytes: EVIL, name: 'vmalert-prod' }]));

/** What a stack might write to "stay current": digests read from the release at apply. */
type Sums = { readonly archive: string; readonly member: string; readonly size: number };
interface FetchedSums extends Resource<'Test.FetchedSums', { url: string }, Sums> {}
const FetchedSums = Resource<FetchedSums>('Test.FetchedSums');
/** ★ It answers with the SWAPPED asset's digests — what the swapped checksum file would say. */
const FetchedSumsProvider = () =>
  Provider.effect(
    FetchedSums,
    Effect.succeed(
      FetchedSums.Provider.of({
        delete: () => Effect.void,
        list: () => Effect.succeed([]),
        reconcile: () =>
          Effect.succeed({
            archive: sha256Hex(SWAPPED),
            member: sha256Hex(EVIL),
            size: SWAPPED.length,
          }),
      }),
    ),
  );

const harness = () => {
  const pins = catalogBinary(syntheticRelease().catalog, VMALERT_REQUEST);
  const fake = fakeLinuxHost({ dirs: { [ROOT]: 0 }, euid: 0 });
  const events: string[] = [];
  const runner: HostRunner = {
    ...fake.runner,
    writeFileAtomic: (path, bytes, options) => {
      events.push(`write ${path}`);
      return fake.runner.writeFileAtomic(path, bytes, options);
    },
  };
  // ★ The attacker's release: the swapped archive at the REAL asset URL.
  const client = HttpClient.make((request, url) => {
    events.push(`GET ${url.toString()}`);
    const body = url.toString() === VMUTILS_URL ? new Blob([SWAPPED.slice()]) : null;
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(body, { status: body ? 200 : 404 })),
    );
  });
  const providers = Layer.mergeAll(
    makeReleaseBinaryProvider({ download: { retries: 0 } }),
    HostDirectoryProvider(),
    FetchedSumsProvider(),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(hostRunnerLayer(runner), Layer.succeed(HttpClient.HttpClient, client)),
    ),
  );
  return { events, fake, pins, stack: fakeStack(providers, {}, 'ApplyPinStack') };
};

type Wiring = 'every digest and the size' | 'the member digest' | 'the archive digest and size';

describe('a pin wired from an Output, on a first deploy', () => {
  test.each<[Wiring, string]>([
    ['every digest and the size', 'archive.sha256 is required, as a plain string'],
    ['the member digest', 'sha256 is required, as a plain string'],
    ['the archive digest and size', 'archive.size must be'],
  ])('%s: refused at apply, nothing fetched, nothing written', async (wiring, refusal) => {
    const h = harness();
    const body = Effect.gen(function* () {
      const dir = yield* HostDirectory('vmutils-1.151.0', { mode: 0o755, path: DIR });
      const sums = yield* FetchedSums('sums', { url: `${VMUTILS_URL}_checksums.txt` });
      const archive =
        wiring === 'the member digest'
          ? h.pins.archive
          : { ...h.pins.archive, sha256: sums.archive, size: sums.size };
      const sha256 = wiring === 'the archive digest and size' ? h.pins.sha256 : sums.member;
      yield* ReleaseBinary('vmalert', { ...h.pins, archive, directory: dir.path, sha256 });
    });
    await expect(h.stack.deploy(body)).rejects.toThrow(refusal);
    expect(h.events).toEqual([]);
    expect(h.fake.files.has(`${DIR}/vmalert`)).toBe(false);
  });

  test('control: the same swap against plain pins is refused by the download it makes', async () => {
    const h = harness();
    const body = Effect.gen(function* () {
      const dir = yield* HostDirectory('vmutils-1.151.0', { mode: 0o755, path: DIR });
      yield* ReleaseBinary('vmalert', { ...h.pins, directory: dir.path });
    });
    await expect(h.stack.deploy(body)).rejects.toThrow('the pin says');
    expect(h.events).toEqual([`GET ${VMUTILS_URL}`]);
    expect(h.fake.files.has(`${DIR}/vmalert`)).toBe(false);
  });
});
