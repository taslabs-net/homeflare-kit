/**
 * ★ The path Cloudflare added in August 2026: identity from `ctx.access`, no JWT parse.
 *   An app team's review (2026-09-16) pointed out the kit only offered the older path —
 *   correctly, and their own suite fails if `jose` appears in that layer.
 */
import { describe, expect, test } from 'bun:test';
import { type AccessContext, accessIdentity, hasAccess } from '../src/access-identity.ts';

const ctxWith = (identity: Record<string, unknown>): AccessContext => ({
  access: { aud: 'test-aud', getIdentity: async () => identity },
});

describe('accessIdentity', () => {
  test('reads identity without touching a token', async () => {
    const who = await accessIdentity(
      ctxWith({ email: 'a@example.com', name: 'A', groups: ['eng', 'ops'] }),
    );

    expect(who?.email).toBe('a@example.com');
    expect(who?.name).toBe('A');
    expect(who?.groups).toEqual(['eng', 'ops']);
  });

  test('returns undefined when the request did not come through Access', async () => {
    // ⛔ undefined, not a throw: a Worker may serve open routes too, so this is a branch
    //   the caller decides — visible at the call site rather than buried in a catch.
    expect(await accessIdentity({})).toBeUndefined();
    expect(hasAccess({})).toBe(false);
  });

  test('groups are always an array, even when absent or malformed', async () => {
    // ⚠️ A caller writing groups.includes(…) on a missing field would throw at exactly
    //   the moment authorization is being decided.
    expect((await accessIdentity(ctxWith({})))?.groups).toEqual([]);
    expect((await accessIdentity(ctxWith({ groups: 'eng' })))?.groups).toEqual([]);
    expect((await accessIdentity(ctxWith({ groups: ['a', 2, null] })))?.groups).toEqual(['a']);
  });

  test('survives getIdentity resolving null', async () => {
    const ctx: AccessContext = { access: { getIdentity: async () => null } };
    expect((await accessIdentity(ctx))?.groups).toEqual([]);
  });

  test('keeps every other field on raw', async () => {
    const who = await accessIdentity(ctxWith({ email: 'a@b.c', device_id: 'd1', is_warp: true }));

    expect(who?.raw['device_id']).toBe('d1');
    expect(who?.raw['is_warp']).toBe(true);
  });

  test('parses no JWT — the module imports nothing from jose', async () => {
    // ⛔ The app team's rule, asserted here: this path must not reach for a token library.
    const src = await Bun.file(new URL('../src/access-identity.ts', import.meta.url)).text();
    expect(src).not.toContain('jose');
  });
});
