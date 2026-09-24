/**
 * Running one `@distilled.cloud/proxmox` typed operation the way `client.ts`'s `pve()` ran a raw
 * HTTP call — same credential lease reuse (lease-cache.ts) and the same cluster-member failover
 * safety rule (members.ts), now handing the request itself to the SDK instead of building one.
 *
 * ★ THIS IS THE SEAM A DISTILLED-BACKED FAMILY CALLS INSTEAD OF `pve()`. `client.ts` stays for
 *   every family not yet migrated — see acl.ts, the first one, for what a migrated family looks
 *   like. A family migrates by calling its own `@distilled.cloud/proxmox/<segment>` typed
 *   operations through `runPve` below, never through a generic method+path+form call: that is
 *   what "no hand-rolled client" means in practice (upstream Alchemy PR 1425).
 *
 * ⚠️ THE WHOLE OPERATION IS RE-RUN PER MEMBER, NOT JUST ONE HTTP CALL. `executeOnCluster` in
 *   members.ts retries a single already-built `HttpClientRequest`; a distilled operation builds
 *   its OWN request internally from whatever `Credentials` it is given, so there is no request to
 *   hand between attempts. Failover here instead re-provides `Credentials` with the next member's
 *   `apiBaseUrl` and re-runs the same operation value. This is safe under the identical rule
 *   `executeOnCluster` documents and members.ts's classifiers still enforce: a write may repeat
 *   only on a PROVABLY pre-send transport failure (connection refused, DNS, a refused
 *   certificate) — never on a timeout after connect, and never on an HTTP answer of any kind,
 *   because an answer (even a typed error the SDK decoded) proves the request reached a live
 *   member and must not be sent again elsewhere. Reads may fail over on any transport failure.
 *
 * ⛔ A TYPED ANSWER-ERROR IS NEVER A REASON TO TRY ANOTHER MEMBER. `Forbidden`,
 *   `ParameterVerificationFailed`, `ClusterNodeUnreachable`, … all mean the request reached a
 *   member and that member answered — `isTransportFailure`/`isPreSendTransport` (members.ts)
 *   return `false` for all of them, exactly as they do for the `HttpClientResponse` case in
 *   `executeOnCluster`, since neither function inspects anything but a transport-level
 *   `HttpClientError`. Such an error propagates from here UNCHANGED — not wrapped, not retried —
 *   which is what lets a caller `catchTag` it directly.
 *
 * TRAP FOUND WHILE WRITING THE FAILOVER TEST: `Retry.none` on every attempt, and it is not
 *   optional. `@distilled.cloud/core`'s DEFAULT policy retries any error in its `ServerError`
 *   category automatically, with no caller opt-in (protocol.ts's own header names the mechanism:
 *   `core/category.ts`'s `isTransientError` via `makeDefault`) -- and that category covers
 *   transport failures too, not just 5xx answers: MEASURED -- a plain `listAccessAcl({})` against
 *   a member that refuses the connection hung past a 5-second test timeout, backing off inside
 *   the SDK before this file's own failover loop ever saw a failure to classify. Left enabled, a
 *   WRITE could be resent to the SAME member several times before `runPveWith` gets a result at
 *   all -- silently reintroducing, inside one member, the exact risk `executeOnCluster`
 *   (members.ts) exists to rule out across members ("a request that may have reached a member
 *   must not be sent again"). The hand-rolled client never auto-retried anything; member failover
 *   was its only resilience. `Retry.none` below keeps that property true here too.
 *
 * ⛔ GAP FOUND ON REVIEW, FIXED 2026-09-24: `Retry.none` only stops the SDK re-sending to the SAME
 *   member -- it added no bound on how long ONE attempt may wait. A member that accepts the TCP
 *   connection but never answers hung this whole function forever, since the for-loop below never
 *   got a result to classify and so never reached a healthy member. `MEMBER_TIMEOUT` (members.ts,
 *   shared with `client.ts`'s `executeOnCluster`) now bounds each attempt; `isTransportFailure`
 *   treats the resulting `Cause.TimeoutError` as failover-eligible for a read, and
 *   `isPreSendTransport` still refuses it for a write, for the same reason a post-send timeout
 *   always was refused.
 */
import type * as Cause from 'effect/Cause';
import type * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { credentials as distilledPveCredentials } from '@distilled.cloud/proxmox/Credentials';
import type { ProxmoxOpContext } from '@distilled.cloud/proxmox/Protocol';
import * as ProxmoxRetry from '@distilled.cloud/proxmox/Retry';
import type { PveCredential, PveRole, PveTarget } from './credentials.ts';
import { leased } from './lease-cache.ts';
import {
  MEMBER_TIMEOUT,
  type MemberAttempt,
  describeTransport,
  isPreSendTransport,
  isTransportFailure,
  noteGoodMember,
  orderedMembers,
  pveApiBase,
} from './members.ts';

/** Every member answered nothing usable — the direct successor to `client.ts`'s `clusterExhausted`. */
export class PveClusterExhausted extends Error {
  constructor(readonly attempts: readonly MemberAttempt[]) {
    super(`all members failed: ${attempts.map((a) => `${a.member} (${a.why})`).join('; ')}`);
    this.name = 'PveClusterExhausted';
  }
}

/**
 * Run `op` against `target`'s cluster on an ALREADY-HELD credential — the direct successor to
 * `client.ts`'s `pveWith`, for a caller reasoning about identity rather than cost (or a test that
 * wants a fixed, explicit credential rather than a live OpenBao mint — see distilled-pve.test.ts).
 *
 * @param isWrite Whether `op` may have a side effect once sent — decides which transport
 *   failures may retry on the next member. Pass `true` for anything that is not a plain read.
 * @param timeout Bound on ONE member's attempt — defaults to `MEMBER_TIMEOUT` (members.ts). A
 *   test passes a short one to prove failover/bounding without waiting out the real bound;
 *   production code never overrides it. A member that answers past this is failed over (a read)
 *   or failed outright (a write, since the request may already have landed) — see
 *   `isTransportFailure`/`isPreSendTransport`.
 */
export const runPveWith = <A, E>(
  target: PveTarget,
  credential: PveCredential,
  isWrite: boolean,
  op: Effect.Effect<A, E, ProxmoxOpContext>,
  timeout: Duration.Input = MEMBER_TIMEOUT,
): Effect.Effect<A, E | Cause.TimeoutError | PveClusterExhausted, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const attempts: MemberAttempt[] = [];
    for (const member of orderedMembers(target)) {
      const credLayer = distilledPveCredentials({
        baseUrl: pveApiBase(member),
        secret: credential.secret,
        tokenId: credential.tokenId,
      });
      const outcome = yield* op.pipe(
        ProxmoxRetry.none,
        Effect.provide(credLayer),
        Effect.timeout(timeout),
        Effect.result,
      );
      if (Result.isSuccess(outcome)) {
        noteGoodMember(target, member);
        return outcome.success;
      }
      const mayRetry = isWrite
        ? isPreSendTransport(outcome.failure)
        : isTransportFailure(outcome.failure);
      if (!mayRetry) return yield* Effect.fail(outcome.failure);
      attempts.push({ member, why: describeTransport(outcome.failure) });
    }
    return yield* Effect.fail(new PveClusterExhausted(attempts));
  });

/**
 * `runPveWith`, minting/reusing a `role` lease exactly as `pve()` did — the seam a migrated
 * resource file calls.
 *
 * ⚠️ `| Error` IN THE RETURN TYPE IS `leased()`'s OWN FAILURE, NOT A NEW ONE THIS FILE ADDS.
 *   `credentials.ts`'s `mint` fails with a plain `Error` (an OpenBao refusal — sealed, denied, no
 *   such role) and was never typed more narrowly there; `pve()` carried the same untyped
 *   possibility before this file existed, just without a signature that said so.
 */
export const runPve = <A, E>(
  target: PveTarget,
  role: PveRole,
  isWrite: boolean,
  op: Effect.Effect<A, E, ProxmoxOpContext>,
): Effect.Effect<A, E | Cause.TimeoutError | PveClusterExhausted | Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const credential = yield* leased(target, role);
    return yield* runPveWith(target, credential, isWrite, op);
  });
