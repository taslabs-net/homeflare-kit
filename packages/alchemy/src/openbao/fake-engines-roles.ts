/**
 * Fakes of the stores behind the batch-2 families, for fake-bao: every role engine, JWT auth config
 * and login-MFA enforcements (`wireRoles`), the TOTP method table (`totpMethods`) and the plugin
 * catalog (`pluginCatalog`), behind one answer (`fakeEstate`). As in fake-engines.ts, each keys its
 * objects the way the real server does, because a rename test is only as good as the fake's idea of
 * "the same object".
 *
 * ⛔ TEST-ONLY — see fake-bao.ts. No provider imports this file.
 */
import type { Reply, Seen } from './fake-bao.ts';
import { ABSENT, type Store, type Stored, lastSegment, store } from './fake-engines.ts';

/**
 * The role stores whose server lowercases the name: AppRole (openbao v2.6.2
 * builtin/credential/approle/path_role.go:1485 and :1893) and Kubernetes
 * (builtin/credential/kubernetes backend.go:362, path_role.go:250 and :396). JWT, PKI and SSH store
 * the name verbatim. The tests mount both at their default paths.
 */
const FOLDED = /^auth\/(approle|kubernetes)\/role\/[^/]+$/;

const keyOf = (path: string): string =>
  FOLDED.test(path) ? path.replace(/[^/]+$/, (name) => name.toLowerCase()) : path;

/** Fields a write sends comma-joined that the server reads back as a list. */
const LISTS = new Set([
  'allowed_domains',
  'cn_validations',
  'ext_key_usage',
  'key_usage',
  'token_policies',
]);

/**
 * The server's typed view of a `k=v` body: `true`, `false` and digit strings become values, and the
 * LISTS split. Arrays, objects and duration strings pass through, and every reader here takes a
 * duration string as well as seconds (`ttlSeconds`).
 */
const typed = (body: Stored): Stored => {
  const out: Stored = {};
  for (const [field, value] of Object.entries(body)) {
    if (typeof value !== 'string') out[field] = value;
    else if (LISTS.has(field)) out[field] = value.split(',').filter((part) => part !== '');
    else if (value === 'true' || value === 'false') out[field] = value === 'true';
    else out[field] = /^\d+$/.test(value) ? Number(value) : value;
  }
  return out;
};

/** Every role engine, JWT auth config and MFA login enforcement. A write replaces the object. */
export const wireRoles = (): Store =>
  store<Stored>(
    (_path, body) => typed(body),
    (path) => keyOf(path),
  );

/**
 * `sys/plugins/catalog/<type>/<name>`. A register names its version in the body; a read or a delete
 * names it in `?version=` (plugin-form.ts versionedPath).
 */
export const pluginCatalog = (): Store =>
  store<Stored>(
    (path, body) => ({ ...body, builtin: false, name: lastSegment(path.split('?')[0] ?? '') }),
    (path, body) => {
      const version = body?.['version'];
      return typeof version === 'string' && version !== '' ? `${path}?version=${version}` : path;
    },
  );

/**
 * `identity/mfa/method/totp`: an upsert by `method_name` (identity/mfa.go:159-230), listed with
 * every other type under `identity/mfa/method?list=true` (mfa-wire.ts). Keyed by the server-made
 * id.
 */
export const totpMethods = (): Store => {
  const live = new Map<string, Stored>();
  let made = 0;
  const answer = (seen: Seen): Reply => {
    const path = seen.path.replace(/^\/v1\//, '');
    if (seen.method === 'POST') {
      const body = JSON.parse(seen.body) as Stored;
      const name = body['method_name'];
      const found = [...live].find(([, method]) => method['name'] === name)?.[0];
      made += found === undefined ? 1 : 0;
      const id = found ?? `method-${String(made)}`;
      live.set(id, { ...body, id, name, namespace_path: '', type: 'totp' });
      return { json: { data: { method_id: id } }, status: 200 };
    }
    if (seen.method === 'DELETE') {
      live.delete(lastSegment(path));
      return { status: 204 };
    }
    if (path !== 'identity/mfa/method?list=true' || live.size === 0) return ABSENT;
    const info = Object.fromEntries(live);
    return { json: { data: { key_info: info, keys: [...live.keys()] } }, status: 200 };
  };
  return Object.assign(answer, { live });
};

/** All three behind one answer, routed by path, for a stack that mixes the families. */
export const fakeEstate = () => {
  const roles = wireRoles();
  const plugins = pluginCatalog();
  const totp = totpMethods();
  const answer = (seen: Seen): Reply => {
    if (seen.path.startsWith('/v1/identity/mfa/method')) return totp(seen);
    if (seen.path.startsWith('/v1/sys/plugins/catalog/')) return plugins(seen);
    return roles(seen);
  };
  return Object.assign(answer, { plugins, roles, totp });
};

export type Estate = ReturnType<typeof fakeEstate>;
