/**
 * `HomeFlare.Access.SaasOidcApplication` — a Cloudflare Access SaaS application that makes Access an
 * OIDC identity provider for one relying party (OpenBao's JWT/OIDC auth, Headlamp, a Kubernetes
 * API server). Usage and the secret rules: docs/saas-oidc.md.
 *
 * 🔴 WHY THIS EXISTS ALONGSIDE `Cloudflare.Access.Application`. Alchemy beta.81's Application has
 *   no `saas_app` field (its source mentions `saas` only as a type and in two comments), and
 *   `@distilled.cloud/cloudflare` rc.13 decodes a saas app's GET and create response WITHOUT it, so
 *   the client id cannot be read back through either. See saas-oidc-api.ts.
 *
 * ⛔ THE TYPE ID IS A STATE KEY, AND THIS ONE WAS MOVED, NOT RENAMED. It is the string the
 *   homeflare-openbao stack's live `OpenBaoOidcSaas` row was written under. A different string would
 *   make the next plan see a new resource and an orphaned one: a second OIDC app, with a new
 *   client id and `aud`, and a delete of the live one unless it were retained. `tests` pin it.
 *
 * ★ `retain` BY DEFAULT, like every kit resource whose deletion breaks its consumers: deleting the
 *   app deletes the client id every relying party is configured with. The openbao declaration
 *   already pipes `RemovalPolicy.retain()`; `delete` stays fully implemented for a declaration
 *   that opts in with `.pipe(RemovalPolicy.destroy())`.
 */
import { Credentials } from '@distilled.cloud/cloudflare/Credentials';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Provider from 'alchemy/Provider';
import { Resource, type ResourceClass } from 'alchemy/Resource';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/http/HttpClient';
import type { Providers } from './providers.ts';
import { deleteSaasOidc, readSaasOidc, reconcileSaasOidc } from './saas-oidc-lifecycle.ts';
import type { SaasOidcApplicationAttributes, SaasOidcApplicationProps } from './saas-oidc-form.ts';

export interface SaasOidcApplication extends Resource<
  'HomeFlare.Access.SaasOidcApplication',
  SaasOidcApplicationProps,
  SaasOidcApplicationAttributes,
  never,
  Providers
> {}

export const SaasOidcApplication: ResourceClass<SaasOidcApplication> =
  Resource<SaasOidcApplication>('HomeFlare.Access.SaasOidcApplication', {
    defaultRemovalPolicy: 'retain',
  });

const accountId = Effect.gen(function* () {
  const resolved = yield* yield* Cloudflare.CloudflareEnvironment;
  return resolved.accountId;
});

/**
 * ★ `Provider.effect`, CAPTURING THE THREE SERVICES AT BUILD, as MeshNodeProvider does
 *   (mesh-node.ts): correct whether or not the stack also merges `Cloudflare.providers()`.
 */
export const SaasOidcApplicationProvider = () =>
  Provider.effect(
    SaasOidcApplication,
    Effect.gen(function* () {
      const services = Context.make(
        Cloudflare.CloudflareEnvironment,
        yield* Cloudflare.CloudflareEnvironment,
      ).pipe(
        Context.add(Credentials, yield* Credentials),
        Context.add(HttpClient.HttpClient, yield* HttpClient.HttpClient),
      );
      // ★ Only the three captured services are provided; `createPhysicalName` still takes
      //   InstanceId, Stack and Stage from the engine at call time, as in every Alchemy provider.
      const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.provideContext(effect, services);

      return SaasOidcApplication.Provider.of({
        stables: ['applicationId', 'aud', 'clientId', 'accountId'],
        /**
         * ⛔ EMPTY, AND `nuke.skip`. Alchemy's own `Cloudflare.Access.Application` already lists
         *   every Access application in the account for `alchemy unsafe nuke` (its `list`, saas
         *   apps included); a second listing here would make nuke delete each app twice.
         */
        list: () => Effect.succeed([]),
        nuke: { skip: true },
        read: ({ id, olds, output }) =>
          run(Effect.flatMap(accountId, (account) => readSaasOidc(account, id, olds, output))),
        reconcile: ({ id, news, output }) =>
          run(Effect.flatMap(accountId, (account) => reconcileSaasOidc(account, id, news, output))),
        delete: ({ output }) => run(deleteSaasOidc(output)),
      });
    }),
  );
