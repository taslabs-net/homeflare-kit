/**
 * fetchMeshNodeToken against the fake Cloudflare, provided the way a Bun `mesh-enroll` script
 * provides it: distilled Credentials from an API token, plus FetchHttpClient.
 *
 * ⛔ The value comes back `Redacted`: printing it, logging it or serialising it shows
 *   `<redacted>`. Only `Redacted.value` yields the token, and only the write to the host's 0600
 *   file should call it.
 */
import { describe, expect, test } from 'bun:test';
import {
  type Credentials,
  fromApiKey,
  fromApiToken,
} from '@distilled.cloud/cloudflare/Credentials';
import * as Effect from 'effect/Effect';
import type * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import { FAKE_ACCOUNT, FAKE_BASE, type FakeMesh, fakeClientLayer, fakeMesh } from './fake-mesh.ts';
import { type MeshNodeRef, fetchMeshNodeToken } from './mesh-node-token.ts';

const token = (fake: FakeMesh, ref: MeshNodeRef) =>
  Effect.runPromise(fetchMeshNodeToken(ref).pipe(Effect.provide(fakeClientLayer(fake))));

const failure = (fake: FakeMesh, ref: MeshNodeRef, credentials?: Layer.Layer<Credentials>) =>
  Effect.runPromise(
    Effect.flip(fetchMeshNodeToken(ref)).pipe(Effect.provide(fakeClientLayer(fake, credentials))),
  );

describe('fetchMeshNodeToken', () => {
  test('by id: the token, redacted everywhere but Redacted.value', async () => {
    const fake = fakeMesh();
    const node = fake.seed({ name: 'door-a' });
    const value = await token(fake, { accountId: FAKE_ACCOUNT, id: node.id });
    expect(Redacted.value(value)).toBe(node.token);
    expect(String(value)).not.toContain(node.token);
    expect(JSON.stringify({ value })).not.toContain(node.token);
    expect(fake.seen.map((s) => s.path)).toEqual([
      `/client/v4/accounts/${FAKE_ACCOUNT}/warp_connector/${node.id}/token`,
    ]);
  });

  test('by name: resolved by exact match first', async () => {
    const fake = fakeMesh();
    fake.seed({ name: 'door-a-2' });
    const node = fake.seed({ name: 'door-a' });
    const value = await token(fake, { accountId: FAKE_ACCOUNT, name: 'door-a' });
    expect(Redacted.value(value)).toBe(node.token);
  });

  test('an unknown node fails with a sentence naming it', async () => {
    const fake = fakeMesh();
    const missing = '00000000-0000-4000-8000-00000000ffff';
    expect((await failure(fake, { accountId: FAKE_ACCOUNT, id: missing })).message).toContain(
      missing,
    );
    expect((await failure(fake, { accountId: FAKE_ACCOUNT, name: 'nope' })).message).toContain(
      'No live Mesh node named "nope"',
    );
  });

  test('an empty token fails closed rather than enrolling nothing', async () => {
    const fake = fakeMesh();
    const node = fake.seed({ name: 'door-a', token: '' });
    const error = await failure(fake, { accountId: FAKE_ACCOUNT, id: node.id });
    expect(error.message).toContain('empty token');
  });

  test('a 403 names the Write permission the endpoint needs', async () => {
    const fake = fakeMesh();
    const node = fake.seed({ name: 'door-a' });
    const denying: FakeMesh = {
      ...fake,
      fetch: (async () =>
        Response.json(
          {
            success: false,
            errors: [{ code: 9109, message: 'Unauthorized to access requested resource' }],
          },
          { status: 403 },
        )) as unknown as typeof globalThis.fetch,
    };
    const error = await failure(denying, { accountId: FAKE_ACCOUNT, id: node.id });
    expect(error.message).toContain('Cloudflare One Connectors Write');
    expect(error.message).toContain(FAKE_ACCOUNT);
  });

  test('refused before any request while DISTILLED_DEBUG_HTTP would print the token', async () => {
    // ⛔ distilled console.errors the first 400 bytes of every response body when this is set.
    const fake = fakeMesh();
    const node = fake.seed({ name: 'door-a' });
    const before = process.env['DISTILLED_DEBUG_HTTP'];
    process.env['DISTILLED_DEBUG_HTTP'] = '1';
    try {
      const error = await failure(fake, { accountId: FAKE_ACCOUNT, id: node.id });
      expect(error.message).toContain('DISTILLED_DEBUG_HTTP');
    } finally {
      if (before === undefined) delete process.env['DISTILLED_DEBUG_HTTP'];
      else process.env['DISTILLED_DEBUG_HTTP'] = before;
    }
    expect(fake.seen).toHaveLength(0);
  });

  test('the Global API Key and an empty API token are refused before any request', async () => {
    const fake = fakeMesh();
    const node = fake.seed({ name: 'door-a' });
    const ref = { accountId: FAKE_ACCOUNT, id: node.id };
    const globalKey = fromApiKey({
      apiKey: 'placeholder-global-key',
      email: 'ops@example.com',
      apiBaseUrl: FAKE_BASE,
    });
    expect((await failure(fake, ref, globalKey)).message).toContain('Global API Key');
    const empty = fromApiToken({ apiToken: '', apiBaseUrl: FAKE_BASE });
    expect((await failure(fake, ref, empty)).message).toContain('EMPTY');
    expect(fake.seen).toHaveLength(0);
  });
});
