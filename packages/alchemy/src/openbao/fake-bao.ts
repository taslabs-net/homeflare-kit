/**
 * A fake OpenBao for the tests beside it — `Bun.serve` on an ephemeral 127.0.0.1 port, or on a unix
 * socket the way an agent listener can be.
 *
 * ⛔ TEST-ONLY, AND NEVER A REAL VAULT. No provider imports this file, it forwards nowhere, and every
 *   helper below runs with an EXPLICIT environment rather than `process.env`, so a BAO_ADDR or
 *   BAO_TOKEN in the shell running the tests can never be read or contacted.
 */
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { BaoEnvironment } from './bao-address.ts';
import { BaoEnv } from './bao-http.ts';

/** One request the fake received. */
export type Seen = {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
};

/** What the fake answers: a status and a JSON value, or raw text for a body that is not JSON. */
export type Reply = { readonly status: number; readonly json?: unknown; readonly text?: string };

export type Fake = { readonly address: string; readonly seen: Seen[]; stop(): void };

/** ★ An answer may be async, so a test can HOLD requests open and count how many overlap. */
type Answer = (seen: Seen) => Reply | Promise<Reply>;

export const fakeBao = (answer: Answer, unix?: string): Fake => {
  const seen: Seen[] = [];
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    const entry = {
      body: await request.text(),
      headers: request.headers,
      method: request.method,
      path: `${url.pathname}${url.search}`,
    };
    seen.push(entry);
    const reply = await answer(entry);
    const text = reply.text ?? (reply.json === undefined ? null : JSON.stringify(reply.json));
    return new Response(reply.status === 204 ? null : text, {
      headers: { 'content-type': 'application/json' },
      status: reply.status,
    });
  };
  if (unix !== undefined) {
    const server = Bun.serve({ fetch, unix });
    return { address: `unix://${unix}`, seen, stop: () => void server.stop(true) };
  }
  const server = Bun.serve({ fetch, hostname: '127.0.0.1', port: 0 });
  return { address: server.url.origin, seen, stop: () => void server.stop(true) };
};

/** Run `body` against a fresh fake, and stop it whatever happens. */
export const withFake = async (
  answer: Answer,
  body: (bao: Fake) => Promise<void>,
  unix?: string,
) => {
  const bao = fakeBao(answer, unix);
  try {
    await body(bao);
  } finally {
    bao.stop();
  }
};

const provided = <A, E>(env: BaoEnvironment, effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
  effect.pipe(Effect.provideService(BaoEnv, env), Effect.provide(FetchHttpClient.layer));

/** The effect's success, through the real FetchHttpClient, under `env` only. */
export const run = <A, E>(
  env: BaoEnvironment,
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) => Effect.runPromise(provided(env, effect));

/** The effect's failure — rejects if it succeeded. */
export const runFailure = <A, E>(
  env: BaoEnvironment,
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) => Effect.runPromise(provided(env, Effect.flip(effect)));

/**
 * An injected crash between a write and its commit. Once armed, `crashNext()` fails the first read
 * that follows a write with a 500 — a reconcile whose write landed and whose read-back, and so the
 * engine's commit, never did — and `crashNext('write')` lands the next write and then answers it
 * 500, for a reconcile that reads nothing back (Bao.Policy). Either leaves the `creating` /
 * `replacing` row a killed deploy leaves.
 */
export const crashAfterWrite = () => {
  let armed: 'read-back' | 'write' | undefined;
  let wrote = false;
  const CRASH: Reply = { json: { errors: ['injected: the deploy died here'] }, status: 500 };
  return {
    crashNext: (at: 'read-back' | 'write' = 'read-back') => {
      armed = at;
      wrote = false;
    },
    wrap:
      (answer: (seen: Seen) => Reply) =>
      (seen: Seen): Reply => {
        if (armed === 'write' && seen.method !== 'GET') {
          armed = undefined;
          answer(seen);
          return CRASH;
        }
        if (armed !== undefined && seen.method !== 'GET') wrote = true;
        if (armed !== undefined && wrote && seen.method === 'GET') {
          armed = undefined;
          return CRASH;
        }
        return answer(seen);
      },
  };
};

/**
 * A deploy killed BEFORE a resource's reconcile ran: the first write to a path ending in `suffix` is
 * refused (500) without landing. Aimed at an upstream, it fails every create waiting on it after
 * Apply has committed their `creating` rows — rows whose create never asked whose object sat at
 * its identity (ownership/whole.ts).
 */
export const refuseWriteOnce = (suffix: string) => {
  let armed = true;
  return (answer: (seen: Seen) => Reply) =>
    (seen: Seen): Reply => {
      if (armed && seen.method !== 'GET' && seen.path.endsWith(suffix)) {
        armed = false;
        return { json: { errors: ['injected: the upstream was refused'] }, status: 500 };
      }
      return answer(seen);
    };
};
