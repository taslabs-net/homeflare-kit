/**
 * A PVE cluster and the OpenBao that mints for it, both answered in-process by one stub `fetch` —
 * so a family's REAL provider can run through Alchemy's engine with every call recorded.
 *
 * ★ A STUB `fetch`, NOT A SERVER. client.test.ts remaps hosts onto Bun.serve to test failover;
 *   here the question is only which calls a lifecycle makes, and a stub answers every URL without
 *   a socket, so nothing can reach a real host whatever the environment says.
 * ⛔ AND THE ENVIRONMENT IS EMPTIED ANYWAY (`withoutBao`, fake-bao-env.ts), so a token in the
 *   shell running the tests is never read.
 * ⚠️ `lease_duration: 0` KEEPS THE LEASE CACHE COLD (lease-cache.ts `timeToLive`), so no fake
 *   credential outlives the test that minted it.
 * ⛔ TEST-ONLY. No provider imports this file.
 */
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type { PveTarget } from './credentials.ts';
import { withFakeBao } from './fake-bao-env.ts';
import { resetLastGoodForTest } from './members.ts';

export const FAKE_TARGET: PveTarget = {
  members: ['pve.test'],
  mount: 'proxmox-test',
  scheme: 'pve',
};

export interface PveCall {
  readonly method: string;
  /** Relative to `/api2/json/`, query included — the string a family passes to `pve()`. */
  readonly path: string;
  readonly form: Readonly<Record<string, string>>;
  /**
   * Every key/value pair in wire order. ⚠️ `form` keeps only the LAST value of a repeated key, and
   * a PBS list IS a repeated key (client.ts `encode`) — assert a list on `pairs`, never `form`.
   */
  readonly pairs: readonly (readonly [string, string])[];
}

/** Answers one call with its `data`; `undefined` is PVE's `{"data": null}`. */
export type PveAnswer = (call: PveCall) => unknown;

export interface FakePve {
  readonly calls: PveCall[];
  /** Every call that is not a GET, as `METHOD path`. */
  readonly writes: () => string[];
  /** Provide over a provider layer: `Provider().pipe(Layer.provideMerge(fake.layer))`. */
  readonly layer: ReturnType<typeof transport>;
}

/** Effect's own fetch client over a stub — client.test.ts wires failover the same way. */
const transport = (stub: typeof fetch) =>
  FetchHttpClient.layer.pipe(Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, stub)));

export const fakePve = (answer: PveAnswer): FakePve => {
  const calls: PveCall[] = [];
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      const data = { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' };
      return Response.json({ data, lease_duration: 0 });
    }
    const path = `${url.pathname.replace(/^\/api2\/json\//, '')}${url.search}`;
    const params = new URLSearchParams(await request.text());
    const call = {
      form: Object.fromEntries(params),
      method: request.method,
      pairs: [...params],
      path,
    };
    calls.push(call);
    return Response.json({ data: answer(call) ?? null });
  };
  // ⚠️ `typeof fetch` carries `preconnect` on bun's lib — client.test.ts has the note.
  const fetchStub = Object.assign(stub, { preconnect: globalThis.fetch.preconnect });
  return {
    calls,
    layer: transport(fetchStub as typeof fetch),
    writes: () => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`),
  };
};

/** Run `body` against the stub's OpenBao (fake-bao-env.ts), then forget the member failover state. */
export const withoutBao = <A>(body: () => Promise<A>): Promise<A> =>
  withFakeBao('http://bao.invalid', body).finally(resetLastGoodForTest);
