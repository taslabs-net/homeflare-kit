/**
 * PBS 4.2.6-1 operations through the distilled SDK, with the existing OpenBao leases.
 *
 * ⛔ PBS IS A SINGLE HOST, NOT A PVE CLUSTER. Its Credentials layer supplies the
 *   `PBSAPIToken=id:secret` scheme; running a PBS operation through runPve would send PVE's
 *   different header. Nothing here invents another host or retries a possibly completed write.
 * ★ Retry.none also disables distilled's default transient-error retries within that host.
 *   MEMBER_TIMEOUT bounds the one attempt, just as it bounds each PVE member attempt.
 */
import { credentials } from '@distilled.cloud/proxmox-backup/Credentials';
import type { ProxmoxBackupOpContext } from '@distilled.cloud/proxmox-backup/Protocol';
import * as Retry from '@distilled.cloud/proxmox-backup/Retry';
import type * as Cause from 'effect/Cause';
import type * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { PveCredentialDenied } from './credential-errors.ts';
import type { PbsTarget, PveCredential, PveRole } from './credentials.ts';
import { leased } from './lease-cache.ts';
import { MEMBER_TIMEOUT } from './members.ts';

/** An already-held lease, also used by offline protocol tests. Production uses the default bound. */
export const runPbsWith = <A, E>(
  target: PbsTarget,
  credential: PveCredential,
  op: Effect.Effect<A, E, ProxmoxBackupOpContext>,
  timeout: Duration.Input = MEMBER_TIMEOUT,
): Effect.Effect<A, E | Cause.TimeoutError, HttpClient.HttpClient> =>
  op.pipe(
    Retry.none,
    Effect.provide(
      credentials({
        baseUrl: target.api,
        secret: credential.secret,
        tokenId: credential.tokenId,
      }),
    ),
    Effect.timeout(timeout),
  );

/** Preserve lease sharing and expose credential refusal and SDK error tags unchanged. */
export const runPbs = <A, E>(
  target: PbsTarget,
  role: PveRole,
  op: Effect.Effect<A, E, ProxmoxBackupOpContext>,
): Effect.Effect<A, E | Cause.TimeoutError | PveCredentialDenied | Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const credential = yield* leased(target, role);
    return yield* runPbsWith(target, credential, op);
  });
