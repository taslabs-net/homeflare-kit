/**
 * The attributes a consumer of a SaasOidcApplication reads through `app.issuer` must stay
 * resolved when the app itself is UPDATED, or every consumer re-plans (the Talos
 * KubeAuthenticationConfig would restart kube-apiserver for a change that cannot move the issuer).
 * Alchemy's plan keeps only the provider's `stables` resolved for an updated resource (Plan.ts
 * `withStables`, beta.81), so this runs the real engine with a downstream resource and counts its
 * reconciles.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { fakeAccess } from './fake-access.ts';
import { IssuerConsumer, consumerProvider } from './saas-oidc-consumer.ts';
import { engine, failureOf, publicClient, writes } from './saas-oidc-harness.ts';
import { SaasOidcApplication } from './saas-oidc.ts';

const declare = (redirect: string) =>
  Effect.gen(function* () {
    const base = publicClient();
    const app = yield* SaasOidcApplication('headlamp', {
      ...base,
      saasApp: { ...base.saasApp, redirectUris: [redirect] },
    });
    yield* IssuerConsumer('kube-auth', { issuer: app.issuer, jwks: app.jwksEndpoint });
  });

describe('consumers of an updated SaasOidcApplication', () => {
  test('a redirect-URI update does not re-plan a resource that reads the issuer', async () => {
    const fake = fakeAccess();
    const consumer = consumerProvider();
    const stack = engine(fake, consumer.layer);
    expect(failureOf(await stack.deploy(declare('https://a.example.test/cb')))).toBe('');
    expect(consumer.reconciled).toHaveLength(1);
    expect(failureOf(await stack.deploy(declare('https://b.example.test/cb')))).toBe('');
    expect(writes(fake)).toEqual(['POST', 'PUT']);
    expect(consumer.reconciled).toHaveLength(1);
    expect(consumer.reconciled[0]).toContain('/cdn-cgi/access/sso/oidc/');
  });
});
