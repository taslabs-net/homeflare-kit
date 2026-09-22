/**
 * A directory of `bao read` exports, loaded — the offline stand-in for production that
 * cloudflare/parity.ts checks the declaration against.
 *
 * The layout, as exported on 2026-09-14 (all of it non-secret):
 *   <dir>/<mount>/<role>.json     `bao read <mount>/roles/<role>` data, `policies` a JSON string
 *   <dir>/<mount>/_catalog.json   the `kv/cloudflare/catalog/<mount>` document apply-roles.py wrote
 *   <dir>/_sys-mounts.json        `sys/mounts`, for each mount's description
 *
 * ⛔ READ-ONLY AND OFFLINE. Nothing here opens a socket or reads a credential; every other `_*`
 *   file in a mount directory is ignored, whatever it holds.
 */
import { type LiveCloudflareRole, liveRoleOf } from './cloudflare-role-form.ts';

type Json = Readonly<Record<string, unknown>>;

export interface CatalogDocument {
  /** Every field of the KV document except `roles`. */
  readonly fields: Json;
  /** `roles`, which apply-roles.py stored as a JSON string (apply-roles.py:68-76), parsed. */
  readonly roles: ReadonlyMap<string, Json>;
}

export interface SnapshotMount {
  readonly mount: string;
  readonly roles: ReadonlyMap<string, LiveCloudflareRole>;
  readonly catalog: CatalogDocument | undefined;
  /** `sys/mounts/<mount>/` description, when the export has one. */
  readonly description: string | undefined;
}

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readJson = async (path: string): Promise<Json | undefined> => {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  const parsed: unknown = await file.json();
  if (!isJson(parsed)) throw new Error(`${path}: not a JSON object`);
  return parsed;
};

const catalogOf = (doc: Json, path: string): CatalogDocument => {
  const raw = doc['roles'];
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!isJson(parsed)) throw new Error(`${path}: roles is not a JSON object`);
  const roles = new Map<string, Json>();
  for (const [name, entry] of Object.entries(parsed)) {
    if (!isJson(entry)) throw new Error(`${path}: roles.${name} is not an object`);
    roles.set(name, entry);
  }
  const { roles: _roles, ...fields } = doc;
  return { fields, roles };
};

/** Load every `cloudflare-*` mount directory under `dir`. */
export const loadSnapshot = async (dir: string): Promise<SnapshotMount[]> => {
  const roles = new Map<string, Map<string, LiveCloudflareRole>>();
  for await (const path of new Bun.Glob('cloudflare-*/*.json').scan({ cwd: dir })) {
    const [mount, file] = path.split('/');
    if (mount === undefined || file === undefined || file.startsWith('_')) continue;
    const data = await readJson(`${dir}/${path}`);
    if (data === undefined) continue;
    const byName = roles.get(mount) ?? new Map<string, LiveCloudflareRole>();
    byName.set(file.replace(/\.json$/, ''), liveRoleOf(data));
    roles.set(mount, byName);
  }
  const sys = await readJson(`${dir}/_sys-mounts.json`);
  const mounts = isJson(sys?.['data']) ? sys['data'] : sys;
  const out: SnapshotMount[] = [];
  for (const mount of [...roles.keys()].sort()) {
    const catalogPath = `${dir}/${mount}/_catalog.json`;
    const catalog = await readJson(catalogPath);
    const entry = mounts?.[`${mount}/`];
    const description = isJson(entry) ? entry['description'] : undefined;
    out.push({
      catalog: catalog === undefined ? undefined : catalogOf(catalog, catalogPath),
      description: typeof description === 'string' ? description : undefined,
      mount,
      roles: roles.get(mount) ?? new Map(),
    });
  }
  return out;
};
