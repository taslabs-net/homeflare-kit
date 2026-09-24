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
 *   HTTP already has one.
 */
import { type Credentials, CredentialsFromEnv } from '@distilled.cloud/litellm/Credentials';
import * as Layer from 'effect/Layer';
import { LiteLLMPassThroughEndpointProvider } from './pass-through-endpoint.ts';

export const litellmProviders = (creds: Layer.Layer<Credentials> = CredentialsFromEnv) =>
  LiteLLMPassThroughEndpointProvider().pipe(Layer.provide(creds));
