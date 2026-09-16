/**
 * ★ The first app that needed this (AnyAuth, 2026-09-16) already had an auth stack:
 *   official `better-auth/minimal` + `@better-auth/drizzle-adapter`. They could not
 *   adopt a scaffold that exported only VERSION and pulled `better-auth-cloudflare`,
 *   which takes over plugins, schema, baseURL and background tasks.
 */
import { describe, expect, test } from 'bun:test';
import { createWorkersAuth } from '../src/workers-auth.ts';

const secret: string = 'a'.repeat(32);
const waitUntil: (promise: Promise<unknown>) => void = () => undefined;

function authOf(
  extra: Omit<Parameters<typeof createWorkersAuth>[0], 'db' | 'waitUntil' | 'secret'> = {},
): ReturnType<typeof createWorkersAuth> {
  return createWorkersAuth({
    db: {},
    waitUntil,
    secret,
    // Tests pass an empty schema; Better Auth's drizzle check would otherwise ERROR.
    advanced: { database: { validateSchema: false } },
    ...extra,
  });
}

describe('createWorkersAuth', () => {
  test('returns a Better Auth instance the app can handle()', () => {
    const auth = authOf();

    expect(typeof auth.handler).toBe('function');
  });

  test('leaves plugins and hooks under application control', () => {
    const plugin = { id: 'app-owned' };
    const before = async (): Promise<undefined> => undefined;

    const auth = authOf({ plugins: [plugin], hooks: { before } });

    const ids = (auth.options.plugins ?? []).map((p: { id: string }) => p.id);
    expect(ids).toContain('app-owned');
    expect(auth.options.hooks?.before).toBe(before);
  });

  test('keeps the official request-derived baseURL the app passed', () => {
    const baseURL = {
      allowedHosts: ['auth.example'],
      fallback: 'https://auth.example',
    };

    const auth = authOf({ baseURL });

    expect(auth.options.baseURL).toEqual(baseURL);
  });

  test('derives a static origin from request only when the app did not set baseURL', () => {
    const fromRequest = authOf({
      request: new Request('https://auth.example/api/auth/ok'),
    });
    expect(fromRequest.options.baseURL).toBe('https://auth.example');

    const appWins = authOf({
      request: new Request('https://ignored.example/'),
      baseURL: 'https://auth.example',
    });
    expect(appWins.options.baseURL).toBe('https://auth.example');
  });

  test('installs waitUntil as the official backgroundTasks handler', () => {
    const auth = authOf();

    expect(auth.options.advanced?.backgroundTasks?.handler).toBe(waitUntil);
  });

  test('does not import better-auth-cloudflare — that package takes over the app', async () => {
    const src = await Bun.file(new URL('../src/workers-auth.ts', import.meta.url)).text();
    // ⛔ Comments name the package we refused; the import graph must not.
    expect(src).not.toMatch(/from ['"]better-auth-cloudflare['"]/);
    expect(src).toMatch(/from 'better-auth\/minimal'/);
    expect(src).toMatch(/from '@better-auth\/drizzle-adapter'/);
  });
});
