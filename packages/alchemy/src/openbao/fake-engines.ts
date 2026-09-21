/**
 * Fakes of the three stores behind Bao.Policy, Bao.CloudflareRole and Bao.ProxmoxRole, for fake-bao.
 * Each keys its objects the way the real server does. That is the point: a rename test is only as
 * good as the fake's idea of "the same object".
 *
 * ⛔ TEST-ONLY — see fake-bao.ts. No provider imports this file.
 */
import type { Reply, Seen } from './fake-bao.ts';
import { parseDuration } from './mount-form.ts';
import { trimTrailing } from './mount-path.ts';
import { policyKey } from './rename.ts';

type Stored = Record<string, unknown>;

/** An answer for fake-bao that also exposes what it holds, keyed by API path (no `/v1/`). */
export type Store = ((seen: Seen) => Reply) & { readonly live: Map<string, Stored> };

const ABSENT: Reply = { json: { errors: [] }, status: 404 };

const store = (
  write: (path: string, body: Record<string, string>, before: Stored | undefined) => Stored,
  key: (path: string) => string = (path) => path,
): Store => {
  const live = new Map<string, Stored>();
  const answer = (seen: Seen): Reply => {
    const path = key(seen.path.replace(/^\/v1\//, ''));
    if (seen.method === 'PUT') {
      const body = JSON.parse(seen.body) as Record<string, string>;
      live.set(path, write(path, body, live.get(path)));
      return { status: 204 };
    }
    // ★ A delete answers 204 whether or not the object existed, as all three do.
    if (seen.method === 'DELETE') {
      live.delete(path);
      return { status: 204 };
    }
    const data = live.get(path);
    return data === undefined ? ABSENT : { json: { data }, status: 200 };
  };
  return Object.assign(answer, { live });
};

const lastSegment = (path: string) => path.split('/').at(-1) ?? '';

/**
 * `sys/policies/acl/<name>`. It strips the policy's trailing newline on write (measured on the live
 * server — digest.ts), and keys the name as OpenBao does: trimmed and lowercased (`policyKey`).
 */
export const aclPolicies = (): Store =>
  store(
    (path, body) => ({
      name: lastSegment(path),
      policy: trimTrailing(body['policy'] ?? '', '\n'),
    }),
    (path) =>
      path.startsWith('sys/policies/acl/')
        ? `sys/policies/acl/${policyKey(decodeURIComponent(lastSegment(path)))}`
        : path,
  );

/**
 * `<mount>/roles/<name>` on the Cloudflare engine. A write parses the duration text into seconds and
 * re-marshals `policies` (path_roles.go:117-146, :199-210). Names are stored verbatim.
 */
export const cloudflareRoles = (): Store =>
  store((path, body) => ({
    description: body['description'],
    max_ttl: parseDuration(body['max_ttl'] ?? ''),
    name: lastSegment(path),
    // ★ Re-marshalled, as json.Marshal of the stored structs would be.
    policies: JSON.stringify(JSON.parse(body['policies'] ?? 'null')),
    ttl: parseDuration(body['ttl'] ?? ''),
  }));

/**
 * `<mount>/roles/<name>` on the proxmox engine. A write MERGES into the stored role, and TTLs go over
 * as seconds (homeflare-openbao-plugins secrets/proxmox/path_roles.go, pathRolesWrite).
 */
export const proxmoxRoles = (): Store =>
  store((path, body, before) => ({
    max_ttl: 0,
    name: lastSegment(path),
    ttl: 0,
    ...before,
    ...(body['mint_user'] === undefined ? {} : { mint_user: body['mint_user'] }),
    ...(body['ttl'] === undefined ? {} : { ttl: Number(body['ttl']) }),
    ...(body['max_ttl'] === undefined ? {} : { max_ttl: Number(body['max_ttl']) }),
  }));
