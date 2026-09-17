/**
 * Where the TypeSafe key lives, as names — never the value.
 *
 * ★ Git holds the path and the field name. OpenBao holds `TYPESAFE_API_KEY`.
 *   The Worker secret / binding uses the same identifier. One string everywhere
 *   means an app can wire Alchemy, wrangler, and `createTypeSafeClientFromBinding`
 *   without inventing a second name that later drifts.
 *
 * ⛔ Do not paste the key into source, `.env`, or this package. A placeholder that
 *   later gets a real value is how keys leak into git history.
 */
export const TYPESAFE_OPENBAO_PATH = 'kv/infra/typesafe/homeflare' as const;

/** OpenBao field, Worker secret, and `env` binding — rename all three together. */
export const TYPESAFE_API_KEY = 'TYPESAFE_API_KEY' as const;
