/**
 * Official TypeSafe System One client, for HomeFlare Workers and scripts.
 *
 * ⛔ THIS IS NOT A REPLACEMENT SDK. We pin and re-export `@typesafe-ai/sdk`. Questions
 *   (`choice` / `noul` / `score`), answer types, and `systemOne()` stay theirs. A local
 *   client would drift the moment they ship a new primitive.
 *
 * ⛔ SERVER-ONLY. The official constructor refuses the browser unless
 *   `dangerouslyAllowBrowser` is set. Never import this from a client module — the API
 *   key would ship to the page.
 *
 * ⚠️ WORKERS HAVE NO `process.env`. The official client falls back to `TYPESAFE_API_KEY`
 *   in the environment, which is fine for a Bun script and empty on workerd. Always pass
 *   the key from a Worker secret / binding via `createTypeSafeClient`.
 *
 * ★ Transport is global `fetch`. That is what workerd provides; no Node HTTP stack.
 */
import { TypeSafeClient, type TypeSafeClientConfig } from '@typesafe-ai/sdk';
import { TYPESAFE_API_KEY } from './location.ts';
import { VERSION } from './version.ts';

export { createTypeSafeGatewayClient, type TypeSafeGatewayOptions } from './gateway.ts';
export { VERSION };
export { TYPESAFE_API_KEY, TYPESAFE_OPENBAO_PATH } from './location.ts';
export { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';
export type { TypeSafeClientConfig } from '@typesafe-ai/sdk';

/** Worker / script binding that holds the TypeSafe API key. */
export type TypeSafeBinding = {
  readonly [TYPESAFE_API_KEY]: string;
};

export type TypeSafeClientOptions = TypeSafeClientConfig & {
  readonly apiKey: string;
};

/**
 * Construct the official client with an explicit key.
 *
 * ⛔ Do not omit `apiKey` and hope `process.env` is set. That path does not exist in a
 *   Worker. The secret stays in Alchemy / OpenBao / the Secret Store; this function
 *   only receives the already-resolved string.
 */
export function createTypeSafeClient(config: TypeSafeClientOptions): TypeSafeClient {
  return new TypeSafeClient({
    ...config,
    apiKey: config.apiKey,
  });
}

/** Same constructor, from the `TYPESAFE_API_KEY` Worker secret / binding. */
export function createTypeSafeClientFromBinding(env: TypeSafeBinding): TypeSafeClient {
  return createTypeSafeClient({ apiKey: env[TYPESAFE_API_KEY] });
}
