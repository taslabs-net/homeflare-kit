/**
 * The three OpenBao calls Bao.Policy makes — read, write and delete of `sys/policies/acl/<name>`.
 * Split from policy.ts so the trailing-newline round trip can be tested against a fake server.
 */
import * as Effect from 'effect/Effect';
import { baoDelete, baoRead, baoWrite } from './bao-http.ts';
import { BaoError } from './bao-status.ts';

/** The endpoint the CLI's policy commands used — openbao v2.6.2 api/sys_policy.go:60, :100, :122. */
export const policyPath = (name: string) => `sys/policies/acl/${name}`;

/**
 * The live policy text, or '' when the policy is genuinely absent. Anything else FAILS.
 *
 * 🔴 THE ABSENCE WORDING WAS THE POLICY COMMAND'S OWN, AND ASSUMING OTHERWISE MADE A NEW POLICY
 *   UNCREATABLE. `No value found at` was measured for `bao read`; `bao policy read` never printed
 *   it. Its API client turned a 404 into an empty string and the CLI reported that in its own
 *   words — openbao v2.6.2 api/sys_policy.go:65-67 and command/policy_read.go:85-87:
 *
 *     No policy named: <name>          exit 2
 *
 *   So `read` on a policy that did not exist yet FAILED instead of answering absent, and
 *   `reconcile` failed at its own pre-write read. Every policy declared so far already existed,
 *   which is the only reason nothing broke. MEASURED 2026-09-14 under the admin lane —
 *   `bao policy read zz-probe-absent-policy-4c1e` printed exactly that line and exited 2. (The
 *   agent lane cannot measure it: it is refused `sys/policies/acl` with a 403 first.)
 * ★ THE WORDING PROBLEM IS GONE WITH THE CLI. The line above was the CLI's rendering of the 404 that
 *   the server returns for a missing policy (vault/logical_system.go handlePoliciesRead returns no
 *   response, which RespondErrorCommon turns into 404). That status is now read directly, and a
 *   refused read is a 403 — two codes, no text to confuse.
 *
 * ⚠️ `data.policy` IS THE TEXT, and a 200 without it is a failure, as it was in the CLI's client
 *   ("no policy found in response", api/sys_policy.go:81-85).
 */
export const readPolicy = (name: string) =>
  Effect.flatMap(baoRead(policyPath(name)), (data) => {
    if (data === undefined) return Effect.succeed('');
    const text = data['policy'];
    return typeof text === 'string'
      ? Effect.succeed(text)
      : Effect.fail(new BaoError(200, 'GET', policyPath(name), ['no data.policy in the response']));
  });

/**
 * ★ THE HCL TRAVELS IN THE REQUEST BODY (`{"policy": …}`, api/sys_policy.go:96-101). The CLI path
 *   needed a scoped temp file because passing HCL on argv would have put every grant in the process
 *   list; a JSON body never reaches argv, so the temp file is gone with it.
 */
export const writePolicy = (name: string, hcl: string) =>
  baoWrite('PUT', policyPath(name), { policy: hcl });

/** Deleting a policy that is already gone answers success (handlePoliciesDelete returns nothing). */
export const deletePolicy = (name: string) => baoDelete(policyPath(name));
