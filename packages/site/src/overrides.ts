/**
 * The environment variables `loadSite` accepts as overrides — and the ONLY ones.
 *
 * ★ WHY A LIST AND NOT "ANY HF_SITE_*". Effect's env provider will happily answer any
 *   path, and three of the answers are wrong without an error. Measured 2026-09-21 on
 *   effect 4.0.0-rc.115, overriding on top of the file via `ConfigProvider.orElse`:
 *   1. A RECORD or ARRAY is REPLACED, not merged. `HF_SITE_NETWORKS_MGMT` decoded
 *      `networks` as `{ "MGMT": … }` — every other network gone, and the key upper-cased.
 *      `HF_SITE_ZONES_MGMT` did the same to `zones`, and `…_LIST_0` truncated a list.
 *   2. A name that is another's name plus `_…` SHADOWS it. With `HF_SITE_LABELS_VAULT_API`
 *      set, `labels.vault` was read as a record (every `HF_SITE_LABELS_VAULT_*` var) and
 *      the decode failed "Expected string". Hence `vault.label` / `vault.apiLabel`.
 *   3. The ORDER of `nested` and `constantCase` decides the prefix: see load.ts.
 *   So only scalar leaves under plain structs are listed, and tests/overrides.test.ts
 *   proves each one changes exactly its own path and nothing else.
 *
 * ⛔ GUARD FIELDS ARE NEVER OVERRIDABLE: `version`, `deriveVersion`, `kind` and
 *   `vault.clusterName`. An exported `HF_SITE_KIND=live` would defeat the stage guard, and
 *   an overridden cluster name would make the identity check compare against itself.
 *
 * ⚠️ `HF_` IS ALSO HUGGING FACE'S PREFIX (`HF_TOKEN`, `HF_HOME`). Only `HF_SITE_*` is read,
 *   and only the names below ever reach the provider.
 */

/** Env var → the site path it overrides. */
export const ENV_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  HF_SITE_APEX: ['apex'],
  HF_SITE_VAULT_LABEL: ['vault', 'label'],
  HF_SITE_VAULT_API_LABEL: ['vault', 'apiLabel'],
  HF_SITE_VAULT_NAMESPACE: ['vault', 'namespace'],
  HF_SITE_VAULT_PORT: ['vault', 'port'],
  HF_SITE_VAULT_MESH_ADDRESS: ['vault', 'meshAddress'],
  HF_SITE_VAULT_OIDC_MOUNT: ['vault', 'oidcMount'],
  HF_SITE_VAULT_CLI_CALLBACK_PORT: ['vault', 'cliCallbackPort'],
  HF_SITE_VAULT_LAN_HOST: ['vault', 'lan', 'host'],
  HF_SITE_VAULT_LAN_PORT: ['vault', 'lan', 'port'],
  HF_SITE_VAULT_LAN_SCHEME: ['vault', 'lan', 'scheme'],
  HF_SITE_CLOUDFLARE_ACCESS_TEAM: ['cloudflare', 'access', 'team'],
  HF_SITE_GITHUB_OWNER: ['github', 'owner'],
  HF_SITE_PATHS_ESTATE_ROOT: ['paths', 'estateRoot'],
};

/** Locates the file; read by `loadSite`, never passed to the provider. */
export const SITE_FILE_VAR = 'HF_SITE_FILE';

const PREFIX = 'HF_SITE_';

/**
 * The accepted overrides present in `env`, or a refusal naming every rejected variable.
 * Returns the names sorted, so a caller can print exactly what changed the file's values.
 */
export function pickOverrides(env: Readonly<Record<string, string | undefined>>): {
  readonly accepted: Readonly<Record<string, string>>;
  readonly refused: readonly string[];
} {
  const accepted: Record<string, string> = {};
  const refused: string[] = [];
  for (const [name, value] of Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.startsWith(PREFIX) || name === SITE_FILE_VAR || value === undefined) continue;
    if (Object.hasOwn(ENV_OVERRIDES, name)) accepted[name] = value;
    else refused.push(name);
  }
  return { accepted, refused };
}
