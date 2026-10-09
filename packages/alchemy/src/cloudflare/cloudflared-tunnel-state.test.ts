/**
 * What Alchemy WRITES for a CloudflaredTunnel, through the real engine (`engine` in
 * cloudflared-tunnel-harness.ts) over the fake Cloudflare: the serialization proof the resource
 * exists for, plus the removal policy and adoption, which live in the engine, not the provider.
 *
 * ⛔ THE PROOF: the rows in the state store, encoded by Alchemy's own `encodeState` (the function
 *   LocalState, HttpStateStore and PostgresState all call before writing), contain no `__redacted__`
 *   marker, no `token` key and no token value — and the fake handed out a token on the create
 *   response, every wire object and its `/token` endpoint. A negative control shows the same
 *   encoder DOES write a `Redacted` token as plaintext, so the absence above means something.
 */
import { describe, expect, test } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as State from 'alchemy/State';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { CloudflaredTunnel } from './cloudflared-tunnel.ts';
import { engine, failureOf, tokenReads, writes } from './cloudflared-tunnel-harness.ts';
import { fakeTunnels } from './fake-tunnel.ts';

const ADMIN = 'admin';
const admin = (name = 'k8s-admin') => CloudflaredTunnel(ADMIN, { name });

const persisted = (rows: object) => JSON.stringify(State.encodeState(rows));

describe('CloudflaredTunnel state serialization', () => {
  test('the persisted state holds no token, no __redacted__ marker and no secret field', async () => {
    const fake = fakeTunnels();
    const stack = engine(fake);
    expect(failureOf(await stack.deploy(admin()))).toBe('');
    // A second deploy re-reads and re-reconciles: the paths Alchemy's own Tunnel reads the token on.
    expect(failureOf(await stack.deploy(admin('k8s-admin-2')))).toBe('');
    const [tunnel] = fake.live();
    const json = persisted(stack.rows);
    expect(json).toContain(tunnel?.id ?? 'no tunnel');
    expect(json).not.toContain(State.REDACTED_MARKER);
    expect(json).not.toContain(tunnel?.token ?? 'no tunnel');
    expect(json).not.toContain('fake-tunnel-token');
    expect(json.toLowerCase()).not.toContain('token');
    expect(json.toLowerCase()).not.toContain('secret');
    expect(tokenReads(fake)).toBe(0);
  });

  test('the attributes in the row are exactly id, accountId, name and status', async () => {
    const fake = fakeTunnels();
    const stack = engine(fake);
    await stack.deploy(admin());
    const row = stack.rows['tunnel']?.['test']?.[ADMIN] as { attr?: object } | undefined;
    expect(Object.keys(row?.attr ?? {}).sort()).toEqual(['accountId', 'id', 'name', 'status']);
  });

  test('negative control: the same encoder writes a Redacted token as a plaintext marker', () => {
    const json = persisted({ attr: { token: Redacted.make('t0ken') } });
    expect(json).toContain(State.REDACTED_MARKER);
    expect(json).toContain('t0ken');
  });
});

describe('CloudflaredTunnel through the real engine', () => {
  test('retain is the default: dropping the declaration leaves the tunnel and sends no DELETE', async () => {
    const fake = fakeTunnels();
    const stack = engine(fake);
    await stack.deploy(admin());
    expect(failureOf(await stack.deploy(Effect.void))).toBe('');
    expect(stack.status(ADMIN)).toBeUndefined();
    expect(fake.live()).toHaveLength(1);
    expect(writes(fake)).toEqual(['POST']);
  });

  test('RemovalPolicy.destroy() still reaches the implemented delete', async () => {
    const fake = fakeTunnels();
    const stack = engine(fake);
    await stack.deploy(admin().pipe(RemovalPolicy.destroy()));
    expect(failureOf(await stack.deploy(Effect.void))).toBe('');
    expect(fake.live()).toHaveLength(0);
    expect(writes(fake)).toEqual(['POST', 'DELETE']);
  });

  test('a rename deploys as a PATCH on the same tunnel', async () => {
    const fake = fakeTunnels();
    const stack = engine(fake);
    await stack.deploy(admin());
    const [before] = fake.live();
    expect(failureOf(await stack.deploy(admin('k8s-admin-2')))).toBe('');
    expect(fake.live().map((t) => [t.id, t.name])).toEqual([[before?.id ?? '', 'k8s-admin-2']]);
    expect(writes(fake)).toEqual(['POST', 'PATCH']);
  });

  test('an existing tunnel is refused without adopt(true), adopted with it, and a repeat writes nothing', async () => {
    const fake = fakeTunnels();
    const tunnel = fake.seed({ name: 'k8s-admin', status: 'healthy' });
    const stack = engine(fake);
    expect(failureOf(await stack.deploy(admin()))).not.toBe('');
    expect(writes(fake)).toEqual([]);
    expect(failureOf(await stack.deploy(admin().pipe(adopt(true))))).toBe('');
    expect(failureOf(await stack.deploy(admin().pipe(adopt(true))))).toBe('');
    expect(writes(fake)).toEqual([]);
    expect(fake.live().map((t) => t.id)).toEqual([tunnel.id]);
    expect(tokenReads(fake)).toBe(0);
    const row = stack.rows['tunnel']?.['test']?.[ADMIN] as { attr?: { id?: string } } | undefined;
    expect(row?.attr?.id).toBe(tunnel.id);
  });
});
