/**
 * Fakes of the three stores behind Bao.Policy, Bao.CloudflareRole and Bao.ProxmoxRole, for fake-bao,
 * plus Bao.Policy's provider over fake fragment directories. Each store keys its objects the way the
 * real server does. That is the point: a rename test is only as good as the fake's idea of "the
 * same object". `store` is shared with fake-engines-roles.ts, which fakes the batch-2 families.
 *
 * ⛔ TEST-ONLY — see fake-bao.ts. No provider imports this file.
 */
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type { Reply, Seen } from './fake-bao.ts';
import { parseDuration } from './mount-form.ts';
import { trimTrailing } from './mount-path.ts';
import { BaoPolicyProvider } from './policy.ts';
import { policyKey } from './rename.ts';

export type Stored = Record<string, unknown>;

/** An answer for fake-bao that also exposes what it holds, keyed by API path (no `/v1/`). */
export type Store = ((seen: Seen) => Reply) & { readonly live: Map<string, Stored> };

export const ABSENT: Reply = { json: { errors: [] }, status: 404 };

/**
 * A store of objects by API path. `key` turns a request path (and a write's body) into the key the
 * server would store it under.
 */
export const store = <B extends Stored = Record<string, string>>(
  write: (path: string, body: B, before: Stored | undefined) => Stored,
  key: (path: string, body?: B) => string = (path) => path,
): Store => {
  const live = new Map<string, Stored>();
  const answer = (seen: Seen): Reply => {
    const raw = seen.path.replace(/^\/v1\//, '');
    // ★ `bao write` sends PUT, and the identity endpoints are called with POST. Both write.
    if (seen.method === 'PUT' || seen.method === 'POST') {
      const body = JSON.parse(seen.body) as B;
      const path = key(raw, body);
      live.set(path, write(path, body, live.get(path)));
      return { status: 204 };
    }
    const path = key(raw);
    // ★ A delete answers 204 whether or not the object existed, as every engine here does.
    if (seen.method === 'DELETE') {
      live.delete(path);
      return { status: 204 };
    }
    const data = live.get(path);
    return data === undefined ? ABSENT : { json: { data }, status: 200 };
  };
  return Object.assign(answer, { live });
};

export const lastSegment = (path: string): string => path.split('/').at(-1) ?? '';

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

/**
 * Bao.Policy's provider over fragment directories that exist only here: `…/empty` holds no file,
 * `…/two` holds two, and any other directory one. Each file is one grant named after its own path,
 * so a directory's content is its name.
 */
export const fakePolicyProviders = Layer.mergeAll(
  BaoPolicyProvider().pipe(
    Layer.provide(
      Layer.mergeAll(
        FileSystem.layerNoop({
          readDirectory: (dir) =>
            Effect.succeed(
              dir.endsWith('/empty') ? [] : dir.endsWith('/two') ? ['a.hcl', 'b.hcl'] : ['a.hcl'],
            ),
          readFileString: (path) =>
            Effect.succeed(`path "${path}" {\n  capabilities = ["read"]\n}`),
        }),
        Path.layer,
      ),
    ),
  ),
  FetchHttpClient.layer,
);
