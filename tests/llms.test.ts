/**
 * Guards llms.txt.
 *
 * ★ WHY TEST A DOC. It is pasted into agents working in OTHER repos, so a stale claim
 *   here becomes wrong code there — and nothing in this repo would fail. These assertions
 *   check it against the real exports and the real catalog, so drift breaks a test rather
 *   than a consumer.
 */
import { describe, expect, test } from 'bun:test';

const root = new URL('../', import.meta.url);
const doc = await Bun.file(new URL('llms.txt', root)).text();

describe('llms.txt', () => {
  test('stays under the 200-line cap it exists to respect', () => {
    // An agent-facing page that does not fit in a glance defeats its own purpose.
    expect(doc.split('\n').length).toBeLessThanOrEqual(200);
  });

  test('every symbol it advertises is actually exported', async () => {
    const kit = await import('../packages/kit/src/index.ts');
    const cf = await import('../packages/cloudflare/src/index.ts');

    for (const name of Object.keys(kit)) expect(doc).toContain(name);
    for (const name of Object.keys(cf)) expect(doc).toContain(name);
  });

  test('the versions it quotes match the catalog', async () => {
    const pkg = (await Bun.file(new URL('package.json', root)).json()) as {
      catalog: Record<string, string>;
    };

    // ⚠️ The versions section is the part most likely to rot: a catalog bump that does
    //   not reach this page sends an agent to pin the old one.
    for (const name of ['zod', 'jose', 'hono', 'ky', 'typescript', 'react']) {
      expect(doc).toContain(`${name} ${pkg.catalog[name]}`);
    }
  });

  test('it tells an agent how to report a gap rather than hand-rolling one', () => {
    expect(doc).toContain('MISSING FROM @homeflare/*');
    expect(doc).toContain('Do not hand-roll');
  });
});
