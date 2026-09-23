/**
 * The LiteLLM provider, with its credential source, as one layer for a stack.
 *
 *     Layer.mergeAll(litellmProviders(), …the stack's other providers)
 *
 * ★ THE DEFAULT READS `LITELLM_PROXY_URL`/`LITELLM_PROXY_API_KEY` AT CALL TIME (credentials.ts),
 *   never at layer build — pass another `Layer.Layer<LitellmCredentials>` (see
 *   `litellmCredentialsLayerFor` in a test) to source them another way.
 * ⚠️ `HttpClient` is NOT provided here. It is ambient in every Alchemy runtime the same way it is
 *   for `netboxProviders`-style families in this kit; a stack that already deploys anything over
 *   HTTP already has one.
 */
import * as Layer from 'effect/Layer';
import { type LitellmCredentials, litellmCredentialsLayer } from './credentials.ts';
import { LiteLLMPassThroughEndpointProvider } from './pass-through-endpoint.ts';

export const litellmProviders = (
  creds: Layer.Layer<LitellmCredentials> = litellmCredentialsLayer,
) => LiteLLMPassThroughEndpointProvider().pipe(Layer.provide(creds));
