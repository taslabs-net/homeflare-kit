/**
 * Namespace spellings, made comparable. `homeflare`, `/homeflare/` and `homeflare/` are one
 * namespace to OpenBao, and `root` (or nothing) is the root namespace.
 *
 * ★ READ FROM openbao v2.6.2: namespace.Canonicalize trims the leading slash and appends a trailing
 *   one, and ResolveNamespaceFromRequest (vault/namespace_store.go:1573-1598) re-routes a header
 *   that is literally `root/` to the root namespace. A namespace's own `namespace_path` in an API
 *   answer is that canonical form: `''` for root, `a/b/` below it (vault/login_mfa.go
 *   mfaConfigToMap and mfaLoginEnforcementConfigToMap).
 */
import { type BaoEnvironment, resolveAddress } from './bao-address.ts';

/** The bare name: no leading or trailing slash, and `''` for the root namespace. */
export const canonicalNamespace = (namespace: string | undefined): string => {
  const bare = (namespace ?? '').trim().replace(/^\/+|\/+$/g, '');
  return bare === 'root' ? '' : bare;
};

/** OpenBao's `namespace_path` rendering of the same namespace: `''` or `a/b/`. */
export const namespacePath = (namespace: string | undefined): string => {
  const bare = canonicalNamespace(namespace);
  return bare === '' ? '' : `${bare}/`;
};

/** The namespace every call under `env` targets, canonical. */
export const envNamespace = (env: BaoEnvironment): string =>
  canonicalNamespace(resolveAddress(env).namespace);

/** How a namespace reads in a message: `root` rather than an empty pair of backticks. */
export const namespaceLabel = (namespace: string): string =>
  namespace === '' ? 'root' : namespace;
