/**
 * SaasOidcApplication through Alchemy's real plan/apply (`engine` in saas-oidc-harness.ts) over the
 * fake Access API. The engine owns state keys, removal policy and what gets persisted, so the
 * handler-level tests beside this one cannot see them.
 *
 * ⛔ WHAT THESE PIN:
 *   - NO CLIENT SECRET IS EVER PERSISTED: the serialised state rows (props and attributes) do not
 *     contain the secret the fake's create response hands out.
 *   - STATE-KEY STABILITY: a row written by the openbao copy of this resource (same type id, props
 *     and attributes without `teamDomain`) is UPDATED IN PLACE by this one — no create, no delete,
 *     the same application id and client id. A renamed type id would plan a second app.
 *   - `retain` is the default: dropping the declaration leaves the app live and sends no DELETE.
 */
import { describe, expect, test } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { FAKE_CLIENT_SECRET, TEAM, fakeAccess } from './fake-access.ts';
import { FAKE_ACCOUNT } from './fake-mesh.ts';
import { LIVE_OIDC, engine, failureOf, publicClient, writes } from './saas-oidc-harness.ts';
import { SaasOidcApplication } from './saas-oidc.ts';

const ID = 'headlamp';
const declare = (over = {}) => SaasOidcApplication(ID, publicClient(over));

describe('SaasOidcApplication (the real engine)', () => {
  test('state holds no client secret, and is keyed by the pinned type id', async () => {
    const fake = fakeAccess();
    const stack = engine(fake);
    expect(failureOf(await stack.deploy(declare()))).toBe('');
    const row = stack.rows['oidc']?.['test']?.[ID];
    expect(row?.resourceType).toBe('HomeFlare.Access.SaasOidcApplication');
    expect(row?.status).toBe('created');
    expect(JSON.stringify(stack.rows)).not.toContain(FAKE_CLIENT_SECRET);
    expect(JSON.stringify(stack.rows)).not.toContain('client_secret');
    expect(JSON.stringify(fake.seen)).not.toContain(FAKE_CLIENT_SECRET);
    expect(row?.attr).toMatchObject({ teamDomain: TEAM, accountId: FAKE_ACCOUNT });
  });

  test('a second identical deploy writes nothing', async () => {
    const fake = fakeAccess();
    const stack = engine(fake);
    await stack.deploy(declare());
    expect(failureOf(await stack.deploy(declare()))).toBe('');
    expect(writes(fake)).toEqual(['POST']);
  });

  test('a row written by the openbao copy is updated in place, never replaced', async () => {
    const fake = fakeAccess();
    const live = fake.seed({
      name: 'Headlamp',
      policies: ['policy-admin'],
      saas_app: LIVE_OIDC,
    });
    const clientId = String(live.saas_app?.['client_id']);
    const stack = engine(fake);
    const { teamDomain: _team, ...oldProps } = publicClient();
    const issuer = `https://${TEAM}/cdn-cgi/access/sso/oidc/${clientId}`;
    stack.rows['oidc'] = {
      test: {
        [ID]: {
          resourceType: 'HomeFlare.Access.SaasOidcApplication',
          namespace: undefined,
          fqn: ID,
          logicalId: ID,
          instanceId: 'i-old',
          providerVersion: 0,
          status: 'created',
          downstream: [],
          bindings: [],
          props: oldProps,
          attr: {
            applicationId: live.id,
            aud: live.aud,
            clientId,
            accountId: FAKE_ACCOUNT,
            name: 'Headlamp',
            domain: issuer.replace('https://', ''),
            issuer,
          },
        },
      },
    };
    expect(failureOf(await stack.deploy(declare()))).toBe('');
    expect(writes(fake)).toEqual([]);
    expect(fake.apps.size).toBe(1);
    expect(stack.rows['oidc']?.['test']?.[ID]?.attr).toMatchObject({
      applicationId: live.id,
      clientId,
      teamDomain: TEAM,
      jwksEndpoint: `${issuer}/jwks`,
    });
  });

  test('retain is the default: dropping the declaration deletes nothing', async () => {
    const fake = fakeAccess();
    const stack = engine(fake);
    await stack.deploy(declare());
    expect(failureOf(await stack.deploy(Effect.void))).toBe('');
    expect(fake.apps.size).toBe(1);
    expect(writes(fake)).toEqual(['POST']);
  });

  test('RemovalPolicy.destroy() still reaches the implemented delete', async () => {
    const fake = fakeAccess();
    const stack = engine(fake);
    await stack.deploy(declare().pipe(RemovalPolicy.destroy()));
    expect(failureOf(await stack.deploy(Effect.void))).toBe('');
    expect(fake.apps.size).toBe(0);
    expect(writes(fake)).toEqual(['POST', 'DELETE']);
  });

  test('a live app is not taken over without adopt(true), and is with it', async () => {
    const fake = fakeAccess();
    fake.seed({
      name: 'Headlamp',
      policies: ['policy-admin'],
      saas_app: LIVE_OIDC,
    });
    const refused = engine(fake);
    expect(failureOf(await refused.deploy(declare()))).not.toBe('');
    expect(writes(fake)).toEqual([]);
    const taken = engine(fake);
    expect(failureOf(await taken.deploy(declare().pipe(adopt(true))))).toBe('');
    expect(writes(fake)).toEqual([]);
    expect(taken.status(ID)).toBe('updated');
  });
});
