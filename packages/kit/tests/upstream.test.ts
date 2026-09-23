/**
 * ★ These assert the FOUR lessons that thirty hand-built clients paid for: fail closed on
 *   a missing credential, never follow a redirect, let each upstream name its auth
 *   scheme, and keep reads separate from writes.
 */
import { describe, expect, test } from 'bun:test';
import { KitError } from '../src/errors.ts';
import { upstream, writableUpstream } from '../src/upstream.ts';

const base = { system: 'probe', urlVar: 'PROBE_URL', defaultUrl: 'http://127.0.0.1:1' };

describe('upstream', () => {
  test('fails closed on a missing credential, naming the fix', () => {
    // ⛔ Omitting the header instead produces a bare 401 from the upstream — which reads
    //   as "bad credential" and sends an operator to rotate a perfectly good secret.
    try {
      upstream({ ...base, tokenVar: 'PROBE_TOKEN', env: {} });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(KitError);
      expect((error as KitError).kind).toBe('misconfigured');
      expect((error as KitError).remedy).toContain('did not render');
    }
  });

  test('treats the string "null" as a missing credential', () => {
    // ⚠️ An unbound workerd binding arrives as the four-character string "null".
    expect(() =>
      upstream({ ...base, tokenVar: 'PROBE_TOKEN', env: { PROBE_TOKEN: 'null' } }),
    ).toThrow(KitError);
  });

  test('needs no credential when the upstream takes none', () => {
    expect(() => upstream({ ...base, env: {} })).not.toThrow();
  });

  test('sends the auth scheme the upstream asked for, not always Bearer', async () => {
    // ⚠️ Django REST Framework wants `Token <value>`; Bearer returns 401 there, and a
    //   wrong scheme is indistinguishable from a wrong credential in the response.
    let seen = '';
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        seen = request.headers.get('authorization') ?? '';
        return Response.json({ ok: true });
      },
    });

    await upstream({
      system: 'probe',
      urlVar: 'PROBE_URL',
      defaultUrl: `http://127.0.0.1:${server.port}`,
      tokenVar: 'PROBE_TOKEN',
      authHeader: (t) => ({ authorization: `Token ${t}` }),
      env: { PROBE_TOKEN: 'secret' },
    })
      .get('/thing')
      .json();
    server.stop();

    expect(seen).toBe('Token secret');
  });

  test('never follows a redirect, so a login page cannot read as a 200', async () => {
    // ⛔ An unauthenticated request is often answered with a 302 to a login page.
    //   Following it returns HTML with status 200 — a broken API, not "not authenticated".
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        return new Response(null, { status: 302, headers: { location: '/login' } });
      },
    });

    const call = upstream({
      system: 'probe',
      urlVar: 'PROBE_URL',
      defaultUrl: `http://127.0.0.1:${server.port}`,
      env: {},
    }).get('/thing');

    // ky throws HTTPError on the 302 itself rather than silently landing on /login.
    await expect(call).rejects.toThrow();
    server.stop();
  });

  test('applies pathPrefix so callers write the documented path', async () => {
    let path = '';
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        path = new URL(request.url).pathname;
        return Response.json({});
      },
    });

    await upstream({
      system: 'probe',
      urlVar: 'PROBE_URL',
      defaultUrl: `http://127.0.0.1:${server.port}`,
      pathPrefix: '/api',
      env: {},
    })
      .get('/dashboards')
      .json();
    server.stop();

    expect(path).toBe('/api/dashboards');
  });

  test('exposes GET and nothing else', () => {
    const reader = upstream({ ...base, env: {} });

    // ⛔ Writes need writableUpstream — a separate function, so widening is a visible
    //   choice at the call site rather than a flag nobody reviews.
    expect(typeof reader.get).toBe('function');
    expect('post' in reader).toBe(false);
    expect('delete' in reader).toBe(false);
  });
});

describe('writableUpstream', () => {
  test('exposes the write verbs', () => {
    const writer = writableUpstream({ ...base, env: {} });

    expect(typeof writer.post).toBe('function');
    expect(typeof writer.delete).toBe('function');
  });
});
