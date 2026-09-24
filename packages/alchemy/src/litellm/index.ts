/**
 * LiteLLM providers for Alchemy.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, deliberately smaller than the directory — `fake-litellm.ts`
 *   and the internals `pass-through-form.ts`/`operations.ts` need but a consumer should not depend
 *   on directly are not re-exported here (netbox/index.ts's own rule).
 * ★ CREDENTIALS AND TYPES NOW COME FROM `@distilled.cloud/litellm` ITSELF (2026-09-24, moved off a
 *   hand-rolled `client.ts`/`credentials.ts` the same way `/netbox` and `/forgejo` did) — a
 *   consumer building its own credentials layer imports `Credentials`/`CredentialsFromEnv`/
 *   `credentials` from `@distilled.cloud/litellm/Credentials` directly, not through this barrel.
 */
export type {
  PassThroughEndpointResponse,
  PassThroughGenericEndpoint,
  PassThroughGuardrailSettings,
} from '@distilled.cloud/litellm/misc';
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
