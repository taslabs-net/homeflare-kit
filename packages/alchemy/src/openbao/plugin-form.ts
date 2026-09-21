/**
 * The form half of Bao.Plugin: props, the paths, the register body, and the equality that decides
 * whether a plan says `noop`. Split from plugin.ts the way mount-form.ts is.
 *
 * ★ THE CATALOG API, READ FROM openbao v2.6.2 — the docs AND the server, because they disagree:
 *   · docs/api/system/plugins-catalog.mdx — `POST sys/plugins/catalog/:type/:name` registers with
 *     `sha256`, `command`, `args`, `env`, `version`, `oci`; `GET` and `DELETE` take `?version=`, which
 *     is REQUIRED to read a plugin registered with one. All three need `sudo`.
 *   · vault/logical_system.go:515-576 handlePluginCatalogRead — answers `name`, `args`, `command`
 *     (relative to plugin_directory), `sha256`, `builtin`, `version`, `oci`, `declarative`. ⚠️ The
 *     docs' sample shows sha256 as BASE64; the server writes `hex.EncodeToString` (:561). Hex wins.
 *   · vault/logical_system.go:441-513 handlePluginCatalogUpdate, and :615-628 getVersion — the
 *     version is canonicalised to `"v" + semver.String()` before it is stored.
 */
import { sha256 as digestOf } from './digest.ts';

export type BaoPluginType = 'auth' | 'database' | 'secret';

export interface BaoPluginProps {
  /** Catalog name — what a mount's `type` names, e.g. `openbao-plugin-secrets-cloudflare`. */
  name: string;
  /** Catalog type. `secret` for a secrets engine, `auth` for an auth method. */
  type: BaoPluginType;
  /** Hex SHA-256 of the binary already sitting in plugin_directory. Case is normalised. */
  sha256: string;
  /** The binary's file name inside plugin_directory — a bare name, no path, no arguments. */
  command: string;
  /**
   * Canonical semver with its `v`, e.g. `v0.1.2`. ⚠️ Declare it when the binary reports its own
   * version — see the ⚠️ on the self-reported version in plugin.ts.
   */
  version?: string;
  /** Arguments, in order. ⛔ Never a secret: they land in Alchemy state and in every catalog read. */
  args?: readonly string[];
}

/** ⛔ NO SECRET HERE — names, a hash, a file name, arguments and a digest. */
export interface BaoPluginAttributes {
  name: string;
  type: BaoPluginType;
  /** The canonical version the catalog stored, `''` when unversioned. Delete needs it. */
  version: string;
  sha256: string;
  command: string;
  args: readonly string[];
  /** True when the catalog answered with OpenBao's own builtin rather than a registration. */
  builtin: boolean;
  /** SHA-256 of the managed fields — safe to persist; see policy.ts. */
  digest: string;
}

/** Every prop resolved to what the register call will store. */
export type BaoPluginForm = Required<BaoPluginProps>;

export const resolve = (props: BaoPluginProps): BaoPluginForm => ({
  args: props.args ?? [],
  command: props.command,
  name: props.name,
  sha256: props.sha256.toLowerCase(),
  type: props.type,
  version: props.version ?? '',
});

/**
 * ⛔ THE VERSION MUST ALREADY BE CANONICAL, OR THE PLAN NEVER GOES GREEN. The server stores
 *   `"v" + semver.String()` (getVersion, :615-628), so `1.2.0`, `v1.2` and `v01.2.0` are all
 *   written as `v1.2.0`, read back as `v1.2.0`, and compared unequal to the declaration forever.
 *   Refusing anything but the canonical spelling is cheaper than reimplementing go-version.
 */
const CANONICAL_VERSION =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/** Everything wrong with the declaration, or `[]`. Checked before any request. */
export const problems = (form: BaoPluginForm): readonly string[] => {
  const found: string[] = [];
  // ⚠️ The route is `(?P<name>.+)` (logical_system_paths.go:1697), so a `/` would nest the storage
  //   key; the server refuses `..` in a name (plugin_catalog.go Set).
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(form.name) || form.name.includes('..')) {
    found.push(`name ${JSON.stringify(form.name)} is not a plain catalog name`);
  }
  if (!/^[0-9a-f]{64}$/.test(form.sha256)) found.push('sha256 is not 64 hex characters');
  /**
   * ⛔ A BARE FILE NAME. The server splits `command` on spaces and keeps the rest as args
   *   (handlePluginCatalogUpdate :487-495), and refuses a binary whose directory is not
   *   plugin_directory itself (plugin_catalog.go setInternal, `symAbs != c.directory`) — so a
   *   path or an argument here either fails the write or reads back as something else.
   */
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(form.command) || form.command.includes('..')) {
    found.push(`command ${JSON.stringify(form.command)} is not a bare file name`);
  }
  if (form.version !== '' && !CANONICAL_VERSION.test(form.version)) {
    found.push(`version ${JSON.stringify(form.version)} is not canonical semver like v1.2.0`);
  }
  // ⚠️ `+builtin` metadata is reserved; the server refuses it (handlePluginCatalogUpdate :462-464).
  if (/\+builtin/.test(form.version)) found.push('version metadata `builtin` is reserved');
  return found;
};

/** `?version=` only when there is one — an unversioned plugin is read without it. */
const versionQuery = (version: string) =>
  version === '' ? '' : `?version=${encodeURIComponent(version)}`;

/** `sys/plugins/catalog/<type>/<name>` — register addresses the plugin here. */
export const catalogPath = (type: BaoPluginType, name: string): string =>
  `sys/plugins/catalog/${type}/${name}`;

/** Read and delete address one VERSION of the plugin. */
export const versionedPath = (type: BaoPluginType, name: string, version: string): string =>
  `${catalogPath(type, name)}${versionQuery(version)}`;

/**
 * The register body — the fields RegisterPluginInput sends (api v2.6.0 sys_plugins.go:186-204),
 * which is what `bao plugin register` sends.
 *
 * ★ `type` IS LEFT OUT OF THE BODY ON PURPOSE. The Go client puts it there as a NUMBER (PluginType
 *   has no MarshalJSON), and the route's `type` capture is what the handler reads. The path says it.
 * ⛔ NO `env`, EVER. The catalog read never returns env (handlePluginCatalogRead's data map has no
 *   such key), so a declared env could not be diffed, and what env exists to carry into a plugin
 *   process is exactly what must not sit in Alchemy's unencrypted state. ⚠️ The register call is a
 *   FULL REPLACE (setInternal builds a fresh entry), so an env someone set by hand is dropped by
 *   the next write — which only happens when a managed field has drifted.
 */
export const registerBody = (form: BaoPluginForm): Record<string, unknown> => ({
  command: form.command,
  sha256: form.sha256,
  ...(form.args.length > 0 ? { args: form.args } : {}),
  ...(form.version === '' ? {} : { version: form.version }),
});

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** ⚠️ `args` is a Go slice, so an entry stored without any can read back `null` — the same as `[]`. */
const list = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export const attributesOf = (
  form: BaoPluginForm,
  live: Record<string, unknown>,
): BaoPluginAttributes => {
  const attrs = {
    name: form.name,
    type: form.type,
    version: text(live['version']),
    sha256: text(live['sha256']).toLowerCase(),
    command: text(live['command']),
    args: list(live['args']),
    builtin: live['builtin'] === true,
  };
  return { ...attrs, digest: digestOf(JSON.stringify(attrs)) };
};

/** ⚠️ ORDER MATTERS for args — they are an argv, not a set. */
const sameArgs = (want: readonly string[], have: readonly string[]) =>
  want.length === have.length && want.every((entry, index) => entry === have[index]);

/** True when the catalog already holds exactly this registration. A builtin never matches. */
export const matches = (attributes: BaoPluginAttributes, form: BaoPluginForm): boolean =>
  !attributes.builtin &&
  attributes.version === form.version &&
  attributes.sha256 === form.sha256 &&
  attributes.command === form.command &&
  sameArgs(form.args, attributes.args);
