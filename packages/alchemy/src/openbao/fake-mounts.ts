/**
 * A fake mount table for fake-bao — `sys/mounts` (secrets engines) or `sys/auth` (auth methods):
 * enable, tune, read, the listing a 400 is settled against (mount-wire.ts), and `sys/remount`.
 * Split out of mount-move.test.ts so the engine-level ownership tests drive Bao.Mount and
 * Bao.AuthMethod through the same table.
 *
 * ⛔ TEST-ONLY — see fake-bao.ts. No provider imports this file.
 */
import type { Reply, Seen } from './fake-bao.ts';

type Entry = { type: string; description: string; config: Record<string, unknown> };

/** A fresh mount's lease TTLs: 0, "use the system default", as the server reports them. */
const zero = () => ({ default_lease_ttl: 0, max_lease_ttl: 0 });

/** The table keyed `<path>/` as the server keys it; `initial` maps a bare path to its type. */
export const liveTable = (prefix: string, initial: Record<string, string>) => {
  const entries = new Map<string, Entry>(
    Object.entries(initial).map(([path, type]) => [
      `${path}/`,
      { config: zero(), description: '', type },
    ]),
  );
  const types = () => new Map([...entries].map(([path, entry]) => [path, entry.type]));
  const answer = (seen: Seen): Reply => {
    const path = seen.path.replace(/^\/v1\//, '');
    if (path === 'sys/remount' && seen.method === 'POST') {
      const { from, to } = JSON.parse(seen.body) as { from: string; to: string };
      const key = `${from.replace(/^auth\//, '')}/`;
      const entry = entries.get(key);
      if (entry === undefined) return { json: { errors: ['no matching mount'] }, status: 400 };
      entries.delete(key);
      entries.set(`${to.replace(/^auth\//, '')}/`, entry);
      return { json: { data: { migration_id: 'm-1' } }, status: 200 };
    }
    if (path.startsWith('sys/remount/status/')) {
      return { json: { data: { migration_info: { status: 'success' } } }, status: 200 };
    }
    if (path === prefix) return { json: { data: Object.fromEntries(types()) }, status: 200 };
    const tune = path.endsWith('/tune');
    const key = `${path.slice(prefix.length + 1).replace(/\/tune$/, '')}/`;
    if (seen.method === 'POST') {
      const body = JSON.parse(seen.body || '{}') as Record<string, unknown>;
      const entry = entries.get(key) ?? {
        config: zero(),
        description: '',
        type: 'enabled-by-test',
      };
      if (!tune && typeof body['type'] === 'string') entry.type = body['type'];
      if (tune) {
        const { description, ...config } = body;
        if (typeof description === 'string') entry.description = description;
        entry.config = { ...entry.config, ...config };
      }
      entries.set(key, entry);
      return { status: 204 };
    }
    if (seen.method === 'DELETE') {
      entries.delete(key);
      return { status: 204 };
    }
    const entry = entries.get(key);
    return entry === undefined
      ? { json: { errors: [`No secret engine mount at ${key}`] }, status: 400 }
      : { json: { data: entry }, status: 200 };
  };
  return {
    answer,
    /** The live table as `<path>/` → type, the shape the move tests compare. */
    get table() {
      return types();
    },
  };
};
