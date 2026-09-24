/**
 * `mint` against a fake OpenBao on Bun.serve — lease parsing, the headers, agent mode, the
 * failures that must never become a credential, and the unix-socket path.
 *
 * ⛔ NO REAL VAULT AND NO REAL ENVIRONMENT. Every call passes an explicit environment, so a
 *   BAO_ADDR or BAO_TOKEN in the shell running the tests is never read.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type { BaoEnvironment, PveTarget } from './credentials.ts';
import { mint } from './mint.ts';

/**
 * ⚠️ THIS PACKAGE'S tsconfig CARRIES NO BUN TYPES, and its package.json is out of bounds for this
 *   change, so the one Bun API the fake needs is typed here, minimally. The tests run under
 *   `bun test`, where `Bun.serve` exists.
 */
type ServeOptions = { fetch(request: Request): Promise<Response> } & (
  | { hostname: string; port: number }
  | { unix: string }
);
const { Bun } = globalThis as unknown as {
  Bun: { serve(options: ServeOptions): { url: URL; stop(closeActive: boolean): void } };
};

const TOKEN = 'hvs.FAKE-sentinel-never-a-real-token';
const SECRET = 'fake-pve-secret-0000';
const C1: PveTarget = {
  members: ['pve.example'],
  mount: 'proxmox-c1',
  scheme: 'pve',
};

type Seen = { path: string; headers: Headers };
type Reply = { status: number; json: unknown };

const withFake = async (
  reply: Reply,
  body: (address: string, seen: Seen[]) => Promise<void>,
  unix?: string,
) => {
  const seen: Seen[] = [];
  const fetch = async (request: Request) => {
    seen.push({ headers: request.headers, path: new URL(request.url).pathname });
    return Response.json(reply.json, { status: reply.status });
  };
  const server = Bun.serve(
    unix === undefined ? { fetch, hostname: '127.0.0.1', port: 0 } : { fetch, unix },
  );
  try {
    await body(unix === undefined ? server.url.origin : `unix://${unix}`, seen);
  } finally {
    server.stop(true);
  }
};

const minted = (env: BaoEnvironment) =>
  Effect.runPromise(mint(C1, 'read', env).pipe(Effect.provide(FetchHttpClient.layer)));
const refused = (env: BaoEnvironment) =>
  Effect.runPromise(mint(C1, 'read', env).pipe(Effect.flip, Effect.provide(FetchHttpClient.layer)));

const CREDENTIAL = {
  json: { data: { secret: SECRET, token_id: 'hf-read@pve!hf-read-1' }, lease_duration: 3600 },
  status: 200,
};

describe('mint', () => {
  it('parses the lease and sends the token, the namespace and X-Vault-Request', async () => {
    await withFake(CREDENTIAL, async (address, seen) => {
      const env = { BAO_ADDR: address, BAO_NAMESPACE: 'homeflare', BAO_TOKEN: TOKEN };
      assert.deepEqual(await minted(env), {
        leaseSeconds: 3600,
        secret: SECRET,
        tokenId: 'hf-read@pve!hf-read-1',
      });
      assert.equal(seen[0]?.path, '/v1/proxmox-c1/creds/read');
      assert.equal(seen[0]?.headers.get('x-vault-token'), TOKEN);
      assert.equal(seen[0]?.headers.get('x-vault-namespace'), 'homeflare');
      assert.equal(seen[0]?.headers.get('x-vault-request'), 'true');
    });
  });

  // ⛔ An unknown lifetime is 0, and lease-cache.ts never keeps a 0-second lease.
  it('reads a missing lease_duration as 0', async () => {
    const reply = { json: { data: { secret: SECRET, token_id: 'hf-read@pve!x' } }, status: 200 };
    await withFake(reply, async (address) => {
      assert.equal((await minted({ BAO_ADDR: address, BAO_TOKEN: TOKEN })).leaseSeconds, 0);
    });
  });

  // ★ AGENT MODE: no BAO_TOKEN, no token header — the listener supplies its auto-auth token.
  it('sends no token header when BAO_TOKEN is unset', async () => {
    await withFake(CREDENTIAL, async (address, seen) => {
      await minted({ BAO_ADDR: address });
      assert.equal(seen[0]?.headers.has('x-vault-token'), false);
    });
  });

  it('fails 404 and 503 with OpenBao errors, never the token', async () => {
    for (const status of [404, 503]) {
      await withFake(
        { json: { errors: [`status ${String(status)}`] }, status },
        async (address) => {
          const error = await refused({ BAO_ADDR: address, BAO_TOKEN: TOKEN });
          assert.ok(error instanceof Error);
          assert.match(
            error.message,
            new RegExp(`-> ${String(status)}: status ${String(status)}$`),
          );
          assert.ok(!error.message.includes(TOKEN));
        },
      );
    }
  });

  // ★ 403 IS THE ONE STATUS WITH ITS OWN TAG (credential-errors.ts) — a family's
  //   `readOrUnreadable` (unreadable-read.ts) `catchTag`s exactly this, never 404/503 above.
  it('fails 403 as the typed PveCredentialDenied, never the token', async () => {
    await withFake({ json: { errors: ['status 403'] }, status: 403 }, async (address) => {
      const error = await refused({ BAO_ADDR: address, BAO_TOKEN: TOKEN });
      assert.ok(error instanceof Error);
      assert.equal((error as { _tag?: string })._tag, 'PveCredentialDenied');
      assert.match(error.message, /-> 403: status 403\. This identity's AppRole has no grant/);
      assert.ok(!error.message.includes(TOKEN));
    });
  });

  // ⛔ FOUND ON ADVERSARIAL REVIEW 2026-09-24: status alone is not enough. A WAF or a proxy in
  //   front of OpenBao can answer 403 without OpenBao ever seeing the request — folding THAT into
  //   `PveCredentialDenied` would hide a real outage behind the same "noop, nothing to worry
  //   about" reading the cries-wolf fix exists to stop, only for a different cause.
  it('a 403 with no OpenBao error body stays the untyped refusal, not PveCredentialDenied', async () => {
    await withFake({ json: { message: 'Forbidden' }, status: 403 }, async (address) => {
      const error = await refused({ BAO_ADDR: address, BAO_TOKEN: TOKEN });
      assert.ok(error instanceof Error);
      assert.equal((error as { _tag?: string })._tag, undefined);
      assert.match(error.message, /-> 403: not an OpenBao error body/);
    });
  });

  it('refuses a 200 with no token_id, without quoting the secret', async () => {
    await withFake({ json: { data: { secret: SECRET } }, status: 200 }, async (address) => {
      const error = await refused({ BAO_ADDR: address, BAO_TOKEN: TOKEN });
      assert.ok(error instanceof Error);
      assert.match(error.message, /returned no token_id\/secret/);
      assert.ok(!error.message.includes(SECRET));
    });
  });

  it('mints over a unix socket', async () => {
    const socket = join(tmpdir(), `fake-bao-mint-${String(process.pid)}.sock`);
    rmSync(socket, { force: true });
    await withFake(
      CREDENTIAL,
      async (address, seen) => {
        assert.equal((await minted({ BAO_ADDR: address })).leaseSeconds, 3600);
        assert.equal(seen[0]?.path, '/v1/proxmox-c1/creds/read');
      },
      socket,
    );
    rmSync(socket, { force: true });
  });
});
