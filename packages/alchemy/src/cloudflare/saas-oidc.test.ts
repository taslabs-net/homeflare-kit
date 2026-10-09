/**
 * SaasOidcApplicationProvider against a fake Access API (fake-access.ts), its handlers called the
 * way the engine calls them. Read, delete and adoption: saas-oidc-read.test.ts.
 *
 * ⛔ THE ASSERTIONS THAT MATTER MOST: a public PKCE client is created with
 *   `allow_pkce_without_client_secret` and the `authorization_code_with_pkce` grant, and the client
 *   secret — which the fake's create response DOES hand out, as the API does on POST — appears in
 *   no attribute, no log line and no request body.
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { StackServices } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import type * as Layer from 'effect/Layer';
import { FAKE_CLIENT_SECRET, TEAM, fakeAccess } from './fake-access.ts';
import { FAKE_ACCOUNT } from './fake-mesh.ts';
import { providers } from './providers.ts';
import { publicClient, reconcile, run, writes } from './saas-oidc-harness.ts';
import { SaasOidcApplication } from './saas-oidc.ts';

// ⛔ Compile-time: a stack's `providers` must be `Layer<…, never, StackServices>`. A provider with
//   an open error channel leaks it here, and `bun run types` catches that.
type Built = Layer.Success<ReturnType<typeof providers>>;
const _stackShaped: Layer.Layer<Built, never, StackServices> = providers();
void _stackShaped;

const postBody = (fake: ReturnType<typeof fakeAccess>) =>
  fake.seen.find((s) => s.method === 'POST')?.body as Record<string, unknown>;

describe('SaasOidcApplication identity', () => {
  test('the type id is the one the openbao state rows are keyed by', () => {
    expect(SaasOidcApplication.Type).toBe('HomeFlare.Access.SaasOidcApplication');
  });
});

describe('create', () => {
  const debug = process.env['DISTILLED_DEBUG_HTTP'];
  afterEach(() => {
    if (debug === undefined) delete process.env['DISTILLED_DEBUG_HTTP'];
    else process.env['DISTILLED_DEBUG_HTTP'] = debug;
  });

  test('a public client is sent as PKCE with no secret, and read back for its client id', async () => {
    const fake = fakeAccess();
    const spies = [spyOn(console, 'log'), spyOn(console, 'error'), spyOn(console, 'warn')];
    const out = await run(fake, (p) => reconcile(p, publicClient()));
    const logged = JSON.stringify(spies.map((spy) => spy.mock.calls));
    for (const spy of spies) spy.mockRestore();
    expect(postBody(fake)).toMatchObject({
      type: 'saas',
      name: 'Headlamp',
      policies: ['policy-admin'],
      saas_app: {
        auth_type: 'oidc',
        grant_types: ['authorization_code_with_pkce'],
        allow_pkce_without_client_secret: true,
        access_token_lifetime: '15m',
      },
    });
    expect(writes(fake)).toEqual(['POST']);
    expect(out).toMatchObject({ accountId: FAKE_ACCOUNT, teamDomain: TEAM, name: 'Headlamp' });
    expect(out.issuer).toBe(`https://${TEAM}/cdn-cgi/access/sso/oidc/${out.clientId}`);
    expect(out.jwksEndpoint).toBe(`${out.issuer}/jwks`);
    // ⛔ The secret was in the create response. It is nowhere we control.
    expect(JSON.stringify(out)).not.toContain(FAKE_CLIENT_SECRET);
    expect(JSON.stringify(fake.seen)).not.toContain(FAKE_CLIENT_SECRET);
    expect(logged).not.toContain(FAKE_CLIENT_SECRET);
    expect(Object.keys(out)).not.toContain('clientSecret');
  });

  test('refuses while DISTILLED_DEBUG_HTTP is set, before any write', async () => {
    process.env['DISTILLED_DEBUG_HTTP'] = '1';
    const fake = fakeAccess();
    // The SDK prints the name lookup's (secret-free) response while the variable is set.
    const quiet = spyOn(console, 'error').mockImplementation(() => {});
    const failure = await run(fake, (p) => Effect.flip(reconcile(p, publicClient())));
    quiet.mockRestore();
    expect(String(failure)).toContain('DISTILLED_DEBUG_HTTP');
    expect(writes(fake)).toEqual([]);
  });

  test('an invalid declaration fails before any request', async () => {
    const fake = fakeAccess();
    const failure = await run(fake, (p) =>
      Effect.flip(reconcile(p, publicClient({ teamDomain: 'https://x.test' }))),
    );
    expect(String(failure)).toContain('teamDomain');
    expect(fake.seen).toEqual([]);
  });
});

describe('reconcile against a live app', () => {
  test('makes zero writes when nothing drifted', async () => {
    const fake = fakeAccess();
    const [first, second] = await run(fake, (p) =>
      Effect.gen(function* () {
        const created = yield* reconcile(p, publicClient());
        return [created, yield* reconcile(p, publicClient(), created)] as const;
      }),
    );
    expect(second).toEqual(first);
    expect(writes(fake)).toEqual(['POST']);
  });

  test('a changed redirect URI is one PUT, and the client id survives', async () => {
    const fake = fakeAccess();
    const base = publicClient();
    const changed = {
      ...base,
      saasApp: { ...base.saasApp, redirectUris: ['https://headlamp.example.test/new'] },
    };
    const [first, second] = await run(fake, (p) =>
      Effect.gen(function* () {
        const created = yield* reconcile(p, base);
        return [created, yield* reconcile(p, changed, created)] as const;
      }),
    );
    expect(writes(fake)).toEqual(['POST', 'PUT']);
    expect(second.redirectUris).toEqual(['https://headlamp.example.test/new']);
    expect(second.clientId).toBe(first.clientId);
    expect(second.applicationId).toBe(first.applicationId);
    expect(JSON.stringify(fake.seen)).not.toContain(FAKE_CLIENT_SECRET);
  });

  test("a declared team that is not the app's team is refused before any write", async () => {
    const fake = fakeAccess({ team: 'real.cloudflareaccess.com' });
    const live = fake.seed({ name: 'Headlamp' });
    const failure = await run(fake, (p) =>
      Effect.flip(
        reconcile(
          p,
          publicClient({ applicationId: live.id, teamDomain: 'other.cloudflareaccess.com' }),
        ),
      ),
    );
    expect(String(failure)).toContain('real.cloudflareaccess.com');
    expect(writes(fake)).toEqual([]);
  });

  test('an id that is not a saas app is refused, never rewritten', async () => {
    const fake = fakeAccess();
    const selfHosted = fake.seed({ name: 'Headlamp', type: 'self_hosted' });
    const failure = await run(fake, (p) =>
      Effect.flip(reconcile(p, publicClient({ applicationId: selfHosted.id }))),
    );
    expect(String(failure)).toContain('not "saas"');
    expect(writes(fake)).toEqual([]);
  });

  test('two saas apps with the declared name are refused, not guessed between', async () => {
    const fake = fakeAccess();
    fake.seed({ name: 'Headlamp' });
    fake.seed({ name: 'Headlamp' });
    const failure = await run(fake, (p) => Effect.flip(reconcile(p, publicClient())));
    expect(String(failure)).toContain('matches 2 live apps');
    expect(writes(fake)).toEqual([]);
  });
});
