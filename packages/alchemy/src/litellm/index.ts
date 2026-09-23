/**
 * LiteLLM providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, deliberately smaller than the directory — `fake-litellm.ts`
 *   and the internals `pass-through-form.ts`/`client.ts` need but a consumer should not depend on
 *   directly are not re-exported here (netbox/index.ts's own rule).
 */
export {
  LITELLM_PROXY_API_KEY_ENV,
  LITELLM_PROXY_URL_ENV,
  LitellmCredentials,
  type LitellmCreds,
  LitellmCredentialsError,
  litellmCredentialsLayer,
  litellmCredentialsLayerFor,
} from './credentials.ts';
export {
  LITELLM_OPERATIONS,
  LitellmBadRequestError,
  type LitellmError,
  LitellmHttpError,
  type LitellmRequirements,
  LitellmTransportError,
  LitellmUnauthorizedError,
} from './client.ts';
export type {
  PassThroughEndpointResponse,
  PassThroughGenericEndpoint,
  PassThroughGuardrailSettings,
} from './generated/pass-through.ts';
export {
  LiteLLMPassThroughEndpoint,
  LiteLLMPassThroughEndpointProvider,
  LitellmConfigPathConflictError,
  LitellmLiteralSecretHeaderError,
  LitellmUnaddressableRowError,
  isLiteLLMPassThroughEndpoint,
  type PassThroughEndpointAttributes,
  type PassThroughEndpointError,
  type PassThroughEndpointProps,
} from './pass-through-endpoint.ts';
export { litellmProviders } from './providers.ts';
