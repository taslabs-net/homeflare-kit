/**
 * The OpenBao calls Bao.CloudflareRole and the live-roles bootstrap make — read, write and delete
 * of `<mount>/roles/<name>`. Split out so each can be tested against fake-bao.
 */
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { baoDelete, baoRead, baoWrite } from './bao-http.ts';
import type { BaoError } from './bao-status.ts';
import { type LiveCloudflareRole, liveRoleOf, rolePath } from './cloudflare-role-form.ts';

/**
 * The live role, or undefined when the engine answers 404.
 *
 * ⚠️ A MISSING MOUNT AND A MISSING ROLE BOTH READ AS UNDEFINED — both are a 404 from OpenBao, the
 *   first as "no handler for route". That is proxmox-role.ts's ⚠️ in full: the WRITE is what tells
 *   them apart, and it lets OpenBao's own `errors` through. A 403 or 503 is never absence
 *   (bao-status.ts).
 */
export const readCloudflareRole = (
  mount: string,
  name: string,
): Effect.Effect<LiveCloudflareRole | undefined, BaoError, HttpClient.HttpClient> =>
  Effect.map(baoRead(rolePath(mount, name)), (data) =>
    data === undefined ? undefined : liveRoleOf(data),
  );

/** ★ `PUT`, which is what `bao write` sent (bao-http.ts). A 404 here fails — see readCloudflareRole. */
export const writeCloudflareRole = (
  mount: string,
  name: string,
  body: Readonly<Record<string, string>>,
) => baoWrite('PUT', rolePath(mount, name), body);

/**
 * Idempotent as Alchemy requires — already gone (404) is success, a refusal is not.
 *
 * ⚠️ THE ENGINE'S DELETE IS ONE STORAGE DELETE (path_roles.go:214-216). Tokens the role already
 *   minted are leases, and they live to their own expiry.
 */
export const deleteCloudflareRole = (mount: string, name: string) =>
  baoDelete(rolePath(mount, name));
