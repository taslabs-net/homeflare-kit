/**
 * The LiteLLM provider, with its credential source, as one layer for a stack.
 *
 *     Layer.mergeAll(litellmProviders(), …the stack's other providers)
 *
 * ★ THE DEFAULT READS `LITELLM_PROXY_URL`/`LITELLM_PROXY_API_KEY` AT CALL TIME, through
 *   `@distilled.cloud/litellm`'s own `CredentialsFromEnv` — the same two variable names the
 *   retired hand-rolled `credentials.ts` read — never at layer build. Pass another
 *   `Layer.Layer<Credentials>` (see the SDK's own `credentials({ apiKey, baseUrl })` in a test) to
 *   source them another way.
 * ⚠️ `HttpClient` is NOT provided here. It is ambient in every Alchemy runtime the same way it is
 *   for `netboxProviders`-style families in this kit; a stack that already deploys anything over
 *   HTTP already has one. Do not add a second client to this layer.
 * ⚠️ `Layer.provideMerge`, NEVER PLAIN `Layer.provide`, for the credentials layer. The handlers
 *   still need `Credentials` when the engine calls `read`/`diff`/`reconcile`. `Provider.effect`
 *   puts that need on the layer. Plain `provide` satisfies it only while the `Provider` value is
 *   built, then hides `Credentials` from those later calls. Measured on Caddy, 2026-09-23:
 *   `caddy/providers.ts`. `provideMerge` feeds credentials in and keeps them in the layer the
 *   engine runs the handlers with.
 */
import { type Credentials, CredentialsFromEnv } from '@distilled.cloud/litellm/Credentials';
import * as Layer from 'effect/Layer';
import { LiteLLMPassThroughEndpointProvider } from './pass-through-endpoint.ts';

export const litellmProviders = (creds: Layer.Layer<Credentials> = CredentialsFromEnv) =>
  LiteLLMPassThroughEndpointProvider().pipe(Layer.provideMerge(creds));
