/**
 * A test-only downstream resource for saas-oidc-stable.test.ts: it takes the app's issuer as a prop
 * and counts how often the engine reconciles it, so a test can tell "planned noop" from "planned
 * update" for a consumer of `app.issuer`. ⛔ TEST-ONLY. No provider imports this file.
 */
import * as Provider from 'alchemy/Provider';
import { Resource } from 'alchemy/Resource';
import * as Effect from 'effect/Effect';

export interface IssuerConsumer extends Resource<
  'Test.IssuerConsumer',
  { readonly issuer: string; readonly jwks: string },
  { readonly issuer: string; readonly jwks: string }
> {}
export const IssuerConsumer = Resource<IssuerConsumer>('Test.IssuerConsumer');

/** The provider, and the list of props it was reconciled with (one entry per reconcile). */
export const consumerProvider = () => {
  const reconciled: string[] = [];
  const layer = Provider.effect(
    IssuerConsumer,
    Effect.succeed(
      IssuerConsumer.Provider.of({
        list: () => Effect.succeed([]),
        reconcile: ({ news }) =>
          Effect.sync(() => {
            reconciled.push(news.issuer);
            return { issuer: news.issuer, jwks: news.jwks };
          }),
        delete: () => Effect.void,
      }),
    ),
  );
  return { layer, reconciled };
};
