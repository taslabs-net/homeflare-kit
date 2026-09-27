/**
 * ⚠️ EXERCISES `mintForKey` ITSELF, NOT A HAND-REPRODUCTION OF ITS CHOICES (second red-team pass
 *   on K-T1). `lease-cache.test.ts`'s `targetForKey` tests call `mintTier(targetForKey(key),
 *   'read')` — passing `'read'` as a LITERAL that happens to match `mintForKey`'s own hardcoded
 *   pve role, so those tests would keep passing even if `mintForKey` minted with a different role
 *   than it reconstructs the target for. A fake OpenBao server pins the ACTUAL request path
 *   `mintForKey` sends.
 *
 * Split out of lease-cache.test.ts (2026-09-27) to keep that file under the 250-line cap once this
 * describe block needed its own fake-server helper and imports — same reasoning as
 * tests/apply-main-ruleset-update.test.ts.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { type BaoEnvironment } from './credentials.ts';
import { type LeaseKey, mintForKey } from './lease-cache.ts';

/** ⚠️ Same minimal Bun typing as credentials.test.ts — this package's tsconfig has no Bun types. */
type ServeOptions = { fetch(request: Request): Promise<Response>; hostname: string; port: number };
const { Bun } = globalThis as unknown as {
  Bun: { serve(options: ServeOptions): { url: URL; stop(closeActive: boolean): void } };
};

describe("K-T1/M3: mintForKey requests the key's own tier, not a re-derived role", () => {
  const withFakeBao = async (body: (address: string, seen: string[]) => Promise<void>) => {
    const seen: string[] = [];
    const server = Bun.serve({
      fetch: async (request: Request) => {
        seen.push(new URL(request.url).pathname);
        return Response.json({ data: { secret: 'x', token_id: 'hf-read@pve!hf-read-1' } });
      },
      hostname: '127.0.0.1',
      port: 0,
    });
    try {
      await body(server.url.origin, seen);
    } finally {
      server.stop(true);
    }
  };
  const env = (address: string): BaoEnvironment => ({ BAO_ADDR: address, BAO_TOKEN: 't' });
  const run = (key: LeaseKey, address: string) =>
    Effect.runPromise(mintForKey(key, env(address)).pipe(Effect.provide(FetchHttpClient.layer)));

  it('a plain pve key mints /creds/<tier> with the bare role tier', async () => {
    await withFakeBao(async (address, seen) => {
      const key: LeaseKey = { mount: 'proxmox-tb4', scheme: 'pve', tier: 'read' };
      await run(key, address);
      assert.equal(seen[0], '/v1/proxmox-tb4/creds/read');
    });
  });

  it('an overridden pve key mints the OVERRIDDEN tier, not a bare role', async () => {
    await withFakeBao(async (address, seen) => {
      const key: LeaseKey = { mount: 'proxmox-tb4', scheme: 'pve', tier: 'talos-provision' };
      await run(key, address);
      assert.equal(seen[0], '/v1/proxmox-tb4/creds/talos-provision');
    });
  });

  it('a pbs key mints its own tier directly', async () => {
    await withFakeBao(async (address, seen) => {
      const key: LeaseKey = { mount: 'pbs-c1', scheme: 'pbs', tier: 'provision' };
      await run(key, address);
      assert.equal(seen[0], '/v1/pbs-c1/creds/provision');
    });
  });
});
