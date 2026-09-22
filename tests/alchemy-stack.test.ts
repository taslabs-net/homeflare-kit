/**
 * Guards the repo's own Alchemy stack.
 *
 * ⛔ LOCAL STATE WAS THE FIRST PASS. It cannot see the other HomeFlare stacks.
 *   `Cloudflare.state()` is the account Durable Object (Secrets Store keys
 *   AlchemyStateStoreToken / AlchemyStateStoreEncryptionKey). Stacks share that
 *   store and are keyed by name. Measured 2026-09-16: wrangler listed those two
 *   secrets on the Cloudflare account; `alchemy state list --backend cloudflare` already
 *   had homeflare-forgejo, homeflare-proxmox, …
 */
import { describe, expect, test } from 'bun:test';

const src = await Bun.file(new URL('../alchemy.run.ts', import.meta.url)).text();

describe('alchemy.run.ts', () => {
  test('uses the account Cloudflare state store, not local .alchemy/', () => {
    expect(src).toContain('Cloudflare.state()');
    expect(src).not.toContain('localState()');
  });

  test('provides Cloudflare and GitHub on the same stack', () => {
    expect(src).toContain('Cloudflare.providers()');
    expect(src).toContain('GitHub.providers()');
    expect(src).toContain('Layer.mergeAll');
  });
});
