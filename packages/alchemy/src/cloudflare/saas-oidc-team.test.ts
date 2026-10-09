/**
 * The team-domain check before a FIRST create (saas-oidc-team.ts): a wrong `teamDomain` is refused
 * with no write when the account's Zero Trust organization can be read, and where it cannot be read
 * the create goes on as it always did, leaving the documented orphan (docs/saas-oidc.md).
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { type FakeAccess, TEAM, fakeAccess } from './fake-access.ts';
import { publicClient, reconcile, run, writes } from './saas-oidc-harness.ts';

const orgReads = (fake: FakeAccess) =>
  fake.seen.filter((s) => s.method === 'GET' && s.path.endsWith('/access/organizations')).length;

describe('a first create checks the declared team against the organization', () => {
  test('a different organization domain is refused before any write', async () => {
    const fake = fakeAccess({ org: { authDomain: 'real.cloudflareaccess.com' } });
    const failure = await run(fake, (p) => Effect.flip(reconcile(p, publicClient())));
    expect(String(failure)).toContain('real.cloudflareaccess.com');
    expect(String(failure)).toContain(TEAM);
    expect(String(failure)).toContain('Refused before any write');
    expect(writes(fake)).toEqual([]);
    expect(fake.apps.size).toBe(0);
  });

  test('the same domain, in any case, creates the app after one organization read', async () => {
    const fake = fakeAccess({ org: { authDomain: TEAM.toUpperCase() } });
    const out = await run(fake, (p) => reconcile(p, publicClient()));
    expect(out.teamDomain).toBe(TEAM);
    expect(orgReads(fake)).toBe(1);
    expect(writes(fake)).toEqual(['POST']);
  });

  test('the organization is read before the create and not again for an existing app', async () => {
    const fake = fakeAccess();
    const [first] = await run(fake, (p) =>
      Effect.gen(function* () {
        const created = yield* reconcile(p, publicClient());
        yield* reconcile(p, publicClient(), created);
        return [created] as const;
      }),
    );
    expect(first.teamDomain).toBe(TEAM);
    expect(orgReads(fake)).toBe(1);
    const order = fake.seen.map((s) => (s.path.endsWith('/organizations') ? 'org' : s.method));
    expect(order.indexOf('org')).toBeLessThan(order.indexOf('POST'));
  });

  test('an owned row whose app vanished is a create again, so it checks again', async () => {
    const fake = fakeAccess();
    const made = await run(fake, (p) => reconcile(p, publicClient()));
    fake.apps.delete(made.applicationId);
    await run(fake, (p) => reconcile(p, publicClient(), made));
    expect(orgReads(fake)).toBe(2);
  });

  test('an update to an existing app never reads the organization', async () => {
    const fake = fakeAccess();
    const live = fake.seed({ name: 'Headlamp', policies: ['policy-old'] });
    await run(fake, (p) => reconcile(p, publicClient({ applicationId: live.id })));
    expect(writes(fake)).toEqual(['PUT']);
    expect(orgReads(fake)).toBe(0);
  });
});

describe('where the organization cannot be read, the create goes on (the known limit)', () => {
  test.each(['unauthorized', 'forbidden', 'not_found'] as const)(
    '%s: one attempt, then the create proceeds with a right team',
    async (org) => {
      const fake = fakeAccess({ org });
      const out = await run(fake, (p) => reconcile(p, publicClient()));
      expect(out.teamDomain).toBe(TEAM);
      // ★ Retry.none: the SDK's default policy would retry "Authentication error" eight times.
      expect(orgReads(fake)).toBe(1);
      expect(writes(fake)).toEqual(['POST']);
    },
  );

  test('a wrong team still writes the app, and the post-write check then fails the run', async () => {
    const fake = fakeAccess({ team: 'real.cloudflareaccess.com', org: 'forbidden' });
    const failure = await run(fake, (p) =>
      Effect.flip(reconcile(p, publicClient({ teamDomain: 'other.cloudflareaccess.com' }))),
    );
    expect(String(failure)).toContain('Cloudflare reports the app on "real.cloudflareaccess.com"');
    // The documented orphan: a live app, and no state row for it (docs/saas-oidc.md).
    expect(writes(fake)).toEqual(['POST']);
    expect(fake.apps.size).toBe(1);
  });
});
