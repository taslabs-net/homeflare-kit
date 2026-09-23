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

  test("declares a 'consumers' environment shaped like 'npm', main-only", () => {
    // ★ release.yml's notify-consumers job needs this environment to exist before
    //   KIT_DISPATCH_APP_KEY can be scoped to it — same trust boundary as npm's
    //   NPM_TOKEN, main-only so a feature branch can never mint a dispatch token.
    const npmIdx = src.indexOf("GitHub.Environment('npm'");
    const consumersIdx = src.indexOf("GitHub.Environment('consumers'");
    expect(npmIdx).toBeGreaterThan(-1);
    expect(consumersIdx).toBeGreaterThan(-1);

    const consumersBlock = src.slice(consumersIdx, src.indexOf('});', consumersIdx));
    expect(consumersBlock).toContain("name: 'consumers'");
    expect(consumersBlock).toContain("customBranchPolicies: ['main']");
  });
});
