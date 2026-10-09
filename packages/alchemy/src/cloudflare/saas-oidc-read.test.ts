/** SaasOidcApplicationProvider's read, delete and adoption paths against the fake Access API. */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import { TEAM, fakeAccess } from './fake-access.ts';
import { FAKE_ACCOUNT, fakeClientLayer } from './fake-mesh.ts';
import { deleteSaasOidc } from './saas-oidc-lifecycle.ts';
import { LIVE_OIDC, publicClient, read, reconcile, run, writes } from './saas-oidc-harness.ts';

describe('read', () => {
  test('finds a cold app by exact name across pages and returns it Unowned', async () => {
    const fake = fakeAccess();
    fake.seed({ name: 'Headlamp-old' });
    fake.seed({ name: 'Other', type: 'self_hosted' });
    const live = fake.seed({ name: 'Headlamp', policies: ['policy-admin'], saas_app: LIVE_OIDC });
    const probe = await run(fake, (p) => read(p, publicClient()));
    expect(Unowned.is(probe)).toBe(true);
    expect(probe).toMatchObject({
      applicationId: live.id,
      clientId: live.saas_app?.['client_id'],
      accountId: FAKE_ACCOUNT,
      redirectUris: ['https://headlamp.example.test/oidc-callback'],
    });
  });

  test('an owned row refreshes by id and is not Unowned', async () => {
    const fake = fakeAccess();
    const [created, refreshed] = await run(fake, (p) =>
      Effect.gen(function* () {
        const made = yield* reconcile(p, publicClient());
        return [made, yield* read(p, publicClient(), made)] as const;
      }),
    );
    expect(Unowned.is(refreshed)).toBe(false);
    expect(refreshed).toEqual(created);
  });

  test('adopts by applicationId from state that predates the teamDomain prop', async () => {
    const fake = fakeAccess();
    const live = fake.seed({ name: 'OpenBao', policies: ['policy-admin'], saas_app: LIVE_OIDC });
    const { teamDomain: _team, ...before } = publicClient({
      applicationId: live.id,
      name: 'OpenBao',
    });
    const probe = await run(fake, (p) => read(p, before as never));
    expect(Unowned.is(probe)).toBe(true);
    expect(probe).toMatchObject({ applicationId: live.id, teamDomain: TEAM });
  });

  test('adopting a matching live app is a no-op: zero writes', async () => {
    const fake = fakeAccess();
    const live = fake.seed({ name: 'Headlamp', policies: ['policy-admin'], saas_app: LIVE_OIDC });
    const out = await run(fake, (p) => reconcile(p, publicClient({ applicationId: live.id })));
    expect(out.applicationId).toBe(live.id);
    expect(writes(fake)).toEqual([]);
  });

  test('answers undefined when nothing matches', async () => {
    const fake = fakeAccess();
    expect(await run(fake, (p) => read(p, publicClient()))).toBeUndefined();
  });
});

describe('delete', () => {
  test('removes the app, and a second delete of the same app is a success', async () => {
    const fake = fakeAccess();
    const out = await run(fake, (p) => reconcile(p, publicClient()));
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* deleteSaasOidc(out);
        yield* deleteSaasOidc(out);
      }).pipe(Effect.provide(fakeClientLayer(fake))),
    );
    expect(fake.apps.size).toBe(0);
    expect(writes(fake)).toEqual(['POST', 'DELETE', 'DELETE']);
  });
});
