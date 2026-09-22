/**
 * A PBS (or PVE) notification config that remembers writes — enough of proxmox-notify's CRUD for
 * a family's REAL provider to create, drift, rotate and adopt through Alchemy's engine.
 *
 * ★ STATEFUL, UNLIKE `fakePve`'s bare answer function, because the questions here are about the
 *   SECOND deploy: whether a rotated secret is written, whether an unchanged one is not. That needs
 *   a server that holds what the first deploy wrote.
 * ★ IT KEEPS proxmox-notify's TWO RULES THAT MATTER HERE (api/webhook.rs, read at HEAD 2026-09-22):
 *     1. a read returns secret NAMES only; values live in a separate private store;
 *     2. a PUT that carries `secret` REPLACES the list, a name without a value keeping the old
 *        one; a PUT without `secret` leaves the list alone. `delete` entries clear a field.
 *   Repeated form keys arrive as arrays, as the real urlencoded decoder builds them.
 * ⛔ TEST-ONLY. No provider imports this file.
 */
import { type FakePve, type PveCall, fakePve } from './fake-pve.ts';
import { keyAndValue } from './pbs-notification-target-wire.ts';

/** Keys the servers take as `type: array`. Everything else is a scalar. */
const LISTS = new Set([
  'header',
  'mailto',
  'mailto-user',
  'match-calendar',
  'match-field',
  'match-severity',
  'secret',
  'target',
]);

export interface FakeNotify extends FakePve {
  /** Public config by path, as a GET would see it apart from secrets. Mutable, for drift. */
  readonly objects: Map<string, Record<string, unknown>>;
  /** Secret items with values (`name=…,value=<base64>`), by path — the root-only file. */
  readonly secrets: Map<string, string[]>;
}

const body = (call: PveCall) => {
  const fields: Record<string, unknown> = {};
  const deletes: string[] = [];
  for (const [key, value] of call.pairs) {
    if (key === 'delete') deletes.push(value);
    else if (LISTS.has(key))
      fields[key] = [...((fields[key] as string[] | undefined) ?? []), value];
    // ⚠️ Scalars as the server's JSON reads them back: a flag as a boolean, a port as a number.
    else if (key === 'disable' || key === 'invert-match') fields[key] = value === '1';
    else if (key === 'port') fields[key] = Number(value);
    else fields[key] = value;
  }
  return { deletes, fields };
};

const withSecretsBlanked = (
  path: string,
  object: Record<string, unknown>,
  secrets: FakeNotify['secrets'],
) => {
  const held = secrets.get(path);
  return held === undefined || held.length === 0
    ? object
    : { ...object, secret: held.map((item) => `name=${keyAndValue(item).name}`) };
};

export const fakeNotify = (
  seed: Readonly<Record<string, Record<string, unknown>>> = {},
): FakeNotify => {
  const objects = new Map(Object.entries(seed).map(([path, object]) => [path, { ...object }]));
  const secrets = new Map<string, string[]>();

  const putSecrets = (path: string, items: readonly string[]) => {
    const old = secrets.get(path) ?? [];
    const next = items.map((item) => {
      const { name, value } = keyAndValue(item);
      if (value !== undefined) return item;
      const kept = old.find((existing) => keyAndValue(existing).name === name);
      if (kept === undefined) throw new Error(`secret '${name}' not known`);
      return kept;
    });
    secrets.set(path, next);
  };

  const fake = fakePve((call) => {
    const path = call.path.split('?')[0] ?? call.path;
    const { deletes, fields } = body(call);
    if (call.method === 'GET') {
      const object = objects.get(path);
      return object === undefined ? undefined : withSecretsBlanked(path, object, secrets);
    }
    if (call.method === 'DELETE') {
      objects.delete(path);
      secrets.delete(path);
      return undefined;
    }
    const target = call.method === 'POST' ? `${path}/${String(fields['name'])}` : path;
    const { secret, ...rest } = fields as { secret?: string[] } & Record<string, unknown>;
    const next: Record<string, unknown> = {
      ...(call.method === 'PUT' ? objects.get(target) : {}),
      ...rest,
    };
    for (const key of deletes) {
      if (key === 'secret') secrets.delete(target);
      else delete next[key];
    }
    objects.set(target, next);
    if (secret !== undefined) putSecrets(target, secret);
    return undefined;
  });
  return { ...fake, objects, secrets };
};
