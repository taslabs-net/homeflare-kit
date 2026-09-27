/**
 * How this package finds out what a node has STAGED, and whether the cluster survived an apply.
 *
 * ★ SPLIT OUT OF network-apply.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is a real
 *   one rather than a convenient line number: this file answers "what is true on the cluster right
 *   now", network-apply.ts answers "what does the resource do about it". Nothing here decides a
 *   diff, and the only write in either file is the apply itself.
 *
 * ⛔ THE PENDING STATE IS NOT IN `data`, WHICH IS WHY THIS FILE DOES ITS OWN FETCH. MEASURED in the
 *   cluster's own source on node-b, 2026-09-13 — not inferred from documentation:
 *     PVE/API2/Network.pm   my $tmp = PVE::INotify::read_file('interfaces', 1);
 *                           $rpcenv->set_result_attrib('changes', $changes) if $changes;
 *     PVE/HTTPServer.pm     if (my $diff = $rpcenv->get_result_attrib('changes')) {
 *                               $resp->{changes} = $diff;
 *                           }
 *   So the answer is `{"data":[…interfaces…],"changes":"<unified diff>"}`: `changes` is a SIBLING
 *   of `data`, set only when the diff is non-empty. `client.ts`'s `pve()` returns `body.data` and
 *   drops the envelope, so the one readable pending signal is invisible to every other resource in
 *   this package. Without the fetch below, `Proxmox.NetworkApply` could not diff honestly at all.
 *   ★ `listNodeNetwork` keeps a string `changes` sibling. The protocol unwraps every other
 *     envelope. The diff string is counted here and then dropped.
 *
 * ⛔ AND THE INTERFACE ROWS CANNOT TELL YOU EITHER. MEASURED in PVE/INotify.pm `read_file`: when
 *   `/etc/network/interfaces.new` exists, THAT is the file that gets parsed, so
 *   `GET /nodes/{node}/network` answers with the STAGED config and a node about to be reconfigured
 *   looks identical to one already running it. Same trap `sdn-apply.ts` documents for `?running=1`.
 *
 * ⚠️ `active` IS NOT A PENDING SIGNAL, AND THE OBVIOUS SHORTCUT IS MEASURABLY WRONG. On node-b and node-c,
 *   with nothing staged anywhere (VERIFIED 2026-09-13: `/etc/network/interfaces.new` absent on node-b,
 *   node-c and node-d), `wlan0` already comes back with no `active` key at all. Counting interfaces that
 *   are not up as "pending" would report an update on two of the three nodes forever.
 *
 * ⚠️ ONE THING GENUINELY CANNOT BE SEEN FROM HERE, AND IT IS SMALL. The diff is computed as
 *   `diff -b -N -u`, so a staged file differing from the live one ONLY in whitespace produces no
 *   `changes` at all. This module reports that node as settled while `interfaces.new` still sits
 *   there waiting for the next reload anybody triggers. The file's existence is not exposed by the
 *   API in any other form, so the alternative is not a better read — it is SSH.
 */
import * as cluster from '@distilled.cloud/proxmox/cluster';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { runPve, runPveWith } from './distilled-pve.ts';
import { type PveCredential, type PveTarget } from './credentials.ts';
import { leased } from './lease-cache.ts';
import { bool, text } from './values.ts';

/** What the cluster looked like the moment it was asked. Never persisted — see network-apply.ts. */
export type ClusterHealth = { quorate: boolean; offline: readonly string[] };

/**
 * The unified diff between a node's applied interfaces file and its staged one, or `''`.
 *
 * ⛔ THIS STRING NEVER LEAVES THIS MODULE, AND THAT IS A SECRET RULE, NOT A STYLE ONE. Alchemy
 *   persists attributes UNENCRYPTED (credentials.ts spells out why), and `/etc/network/interfaces`
 *   is a file that can legally contain `wpa-psk` — node-b and node-c both carry a `wlan0`, MEASURED — as
 *   well as any `pre-up` command somebody wrote. A diff of that file in a state store is a secret
 *   in a state store. Only the COUNT below ever escapes.
 */
const stagedDiff = (target: PveTarget, node: string) =>
  Effect.gen(function* () {
    // ⚠️ THE `read` ROLE IS ENOUGH, AND DELIBERATELY SO. The schema's permission for this GET is
    //   `"user": "all"` — no privilege check at all — so the pending read never needs the
    //   provisioning lease, and a plan stays a plan even if the write role is missing entirely.
    // ⛔ THROUGH THE LEASE CACHE, NOT `mint`. This read needs no particular identity — only the
    //   apply and its task poll do, and network-apply.ts mints for those itself. Minting here left
    //   SIX extra `hf-read@pve` tokens on node-b per C1 plan (one per node, for read and for diff),
    //   MEASURED 2026-09-14 while the cache itself made one read mint for the whole run.
    const credential = yield* leased(target, 'read');
    const live = yield* runPveWith(target, credential, false, nodes.listNodeNetwork({ node }));
    // ⛔ The diff string is not returned from pendingCount and is not an attribute.
    return Array.isArray(live) ? '' : live.changes;
  });

/**
 * Changed lines in a unified diff.
 *
 * ⚠️ A NON-EMPTY DIFF IS NEVER REPORTED AS ZERO, WHICH IS WHAT `Math.max` IS FOR. The `+++`/`---`
 *   headers have to be skipped, and a removed line whose own text starts with `---` is skipped with
 *   them; a staged change consisting of nothing else would otherwise count 0 and be reported as
 *   "settled", which is the exact lie this resource exists to prevent. The count is informational —
 *   the resource only ever compares it to zero — so an occasional undercount of 1 is harmless while
 *   an undercount to zero is not.
 */
export const pendingLines = (diff: string) => {
  if (diff === '') return 0;
  const changed = diff
    .split('\n')
    .filter(
      (line) =>
        (line.startsWith('+') || line.startsWith('-')) &&
        !line.startsWith('+++') &&
        !line.startsWith('---'),
    ).length;
  return Math.max(changed, 1);
};

/** How many staged lines this node is carrying. Zero is the only settled value. */
export const pendingCount = (target: PveTarget, node: string) =>
  stagedDiff(target, node).pipe(Effect.map(pendingLines));

/**
 * Quorum, and every member that is not online.
 *
 * ⛔ QUORUM ALONE IS NOT THE CHECK, AND ON A THREE-NODE CLUSTER IT WOULD MISS THE ACCIDENT THIS
 *   RESOURCE IS AFRAID OF. Losing ONE of three leaves `quorate: 1` — MEASURED shape on C1:
 *   `{"id":"cluster","name":"HF-C1","nodes":3,"quorate":1,…}` plus one row per node with
 *   `online: 1`. So a reload that drops node-b off the network is invisible to `quorate` and visible
 *   only as `online: 0` on that row. Both are checked, and the node names come back so the failure
 *   message can say WHICH member went away.
 *
 * ⚠️ AN UNCLUSTERED NODE IS QUORATE BY DEFINITION. A standalone PVE answers with node rows and no
 *   `cluster` row; reading that absence as "not quorate" would make this resource undeclarable on
 *   every single-node install.
 *
 * ⚠️ THIS ONE NEEDS `Sys.Audit` ON `/` — the only privilege in this family beyond the apply itself.
 *   It is asked of the `read` role, which is auditor-shaped, rather than of `provision`.
 */
const clusterHealth = (target: PveTarget) =>
  runPve(target, 'read', false, cluster.listClusterStatus({})).pipe(
    Effect.map((rows) => {
      const all = rows ?? [];
      const cluster = all.find((row) => row.type === 'cluster');
      return {
        offline: all
          .filter((row) => row.type === 'node' && !bool(row.online))
          .map((row) => text(row.name, '<unnamed>')),
        quorate: cluster === undefined ? true : bool(cluster.quorate),
      } satisfies ClusterHealth;
    }),
  );

/**
 * Why the cluster is not healthy, or `undefined` when it is.
 *
 * ★ A REASON RATHER THAN A BOOLEAN, BECAUSE THE CALLER'S ONLY USE FOR IT IS A REFUSAL MESSAGE.
 *   "The deploy stopped because the cluster was degraded" is not actionable at three in the
 *   morning; "quorate=true offline=[node-c]" is. The two callers in network-apply.ts ask this before
 *   the reload and again after it, and the second answer is the one that stops the chain from
 *   reaching the next node.
 *
 * ⚠️ A MEMBER OFFLINE FOR AN UNRELATED REASON BLOCKS EVERY APPLY, AND THAT IS THE INTENDED
 *   BEHAVIOUR RATHER THAN AN OVERSIGHT. A node down for maintenance is one failure away from the
 *   pools losing min_size; reloading another node's networking while it is out is the move that
 *   completes the outage. Bring it back, or apply by hand with the cluster in front of you.
 */
export const degradedReason = (target: PveTarget) =>
  clusterHealth(target).pipe(
    Effect.map((health) =>
      health.quorate && health.offline.length === 0
        ? undefined
        : `quorate=${String(health.quorate)} offline=[${health.offline.join(', ')}]`,
    ),
  );

/**
 * ⛔ NOT AN EXITSTATUS PVE CAN RETURN, AND THAT IS THE POINT. The caller compares against `'OK'`;
 *   these two say WHY the answer is not OK without needing a second branch for "we do not know".
 */
export const UNREACHABLE =
  'the task could not be read -- the node stopped answering, or this lease cannot see it';
const STILL_RUNNING = 'still running when this provider stopped waiting';

/**
 * How long to wait on `ifreload`, in one-second polls.
 *
 * ⚠️ THIRTY SECONDS IS A CEILING, NOT AN EXPECTATION. A reload of a handful of interfaces finishes
 *   in a second or two; past thirty, something is wrong in a way a deploy cannot fix by waiting,
 *   and the honest move is to stop and name the task rather than park the stack on it.
 */
const ATTEMPTS = 30;

/**
 * Wait for one `srvreload` task and answer its exitstatus.
 *
 * ⛔ THE APPLY IS ASYNCHRONOUS AND ITS 200 MEANS NOTHING. MEASURED: `reload_network_config` ends
 *   `return $rpcenv->fork_worker('srvreload', 'networking', $authuser, $worker)`, so the PUT
 *   returns a UPID the instant the worker is forked — before `ifreload -a` has run, let alone
 *   succeeded. Waiting for the task is the only way to learn the outcome.
 *
 * ⛔ AND IT MUST BE POLLED WITH THE CREDENTIAL THAT STARTED IT. The task-status schema says
 *   `"user": "all"` with the note "needs 'Sys.Audit' on '/nodes/<node>' if they are not the owner
 *   of the task". Every mint returns a NEW token id, so a second mint is a different identity and
 *   is not the owner — which is why this takes a `PveCredential` and the caller keeps one lease
 *   across both calls, instead of widening the provisioning role to read its own tasks.
 *
 * ★ A poll failure stays `UNREACHABLE`. `getNodeTaskStatus` would otherwise fail the reload
 *   on the connection drop this function exists to survive.
 */
export const awaitTask = (
  target: PveTarget,
  credential: PveCredential,
  node: string,
  upid: string,
  // ★ A CALLER WHOSE TASK IS SLOWER THAN A RELOAD SAYS SO: an LXC create unpacks a template.
  attempts: number = ATTEMPTS,
) =>
  Effect.gen(function* () {
    // ★ The SDK percent-encodes the UPID label. PVE APIServer unescapes it before routing.
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      /**
       * ⛔ A FAILED POLL IS NOT A FAILED RELOAD, AND CALLING IT ONE WOULD BE THE WORST KIND OF
       *   WRONG. If the member serving the poll is the node being reloaded, `ifreload -a` can drop
       *   the very connection this poll rides on — see network-apply.ts.
       *   The reload may well have succeeded. So the call is collapsed to "we cannot see the task"
       *   and the caller reports the outcome as UNKNOWN, with the UPID, rather than guessing.
       * ⚠️ A 403 LANDS HERE TOO, AND IT READS THE SAME. If the polling identity is somehow not the
       *   task's owner, the endpoint wants `Sys.Audit` on the node and this sees only "no answer" —
       *   which is why `UNREACHABLE` names both possibilities rather than blaming the network.
       */
      const status = yield* runPveWith(
        target,
        credential,
        false,
        nodes.getNodeTaskStatus({ node, upid }),
      ).pipe(Effect.orElseSucceed(() => undefined));
      if (status === undefined) return UNREACHABLE;
      if (status.status === 'stopped') return text(status.exitstatus, 'stopped with no exitstatus');
      yield* Effect.sleep('1 second');
    }
    return STILL_RUNNING;
  });
