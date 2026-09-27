/**
 * The Ceph mon-command transport (K-A4, T-A): ssh to one of the TB4 mon nodes, `sudo -n
 * /usr/bin/ceph …`, tried in node order. Every call is checked against ceph-argv.ts's allowlist
 * BEFORE anything dials — a refused shape never opens a connection, never mind runs a command.
 *
 * ★ BUILT ON THE SAME WIRE FORMAT sshSudoRunner USES, NOT A SECOND ONE. `runRemote` (the framed
 *   script + nonce marker `../linux/ssh-command.ts` and `../linux/ssh-runner.ts` already ship and
 *   test) is reused directly: same fail-closed behaviour on a dropped connection, same
 *   `BatchMode=yes`, same host-key verification left to the operator's own ssh config.
 * ⛔ THE DIAL IS AN INJECTED SEAM, NOT child_process MOCKED. `CephDial` is the same idea as
 *   `HostRunner` (../launchd/runner.ts): production code gets `sshCephDial`, tests hand a fake
 *   function directly (fake-ceph-dial.ts) — no ssh binary, no spawned process, ever, in a test.
 * ⛔ A TRANSPORT FAILURE (no mon reachable) IS NEVER "ABSENT". Only a mon that actually ran the
 *   command and answered gets to say whether an entity exists; every node failing to connect
 *   propagates as an Error, so a down anchor can never read as "recreate it".
 * ⛔ ONLY ARGV IS EVER LOGGED. `log` is called with the shape being attempted, never with a
 *   result's stdout or stderr — `auth get`/`auth get-or-create`'s stdout carries the entity's key.
 */
import { randomBytes } from 'node:crypto';
import { quoteArgv } from '../linux/ssh-command.ts';
import { runRemote } from '../linux/ssh-runner.ts';
import { SUDO, SudoRefusedError } from '../linux/sudo-allowlist.ts';
import { cephCommandProblem, quorumStatusArgv } from './ceph-argv.ts';
import { parseQuorumStatus } from './ceph-auth-parse.ts';

export type CephExecResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** One attempt against one mon: run `argv` (already sudo-wrapped by the caller) and report. */
export type CephDial = (node: string, argv: readonly string[]) => Promise<CephExecResult>;

const CONNECT_TIMEOUT_SEC = 10;
const EXEC_TIMEOUT_MS = 30_000;

/** ★ A fresh nonce per attempt — this dial never reuses a connection or a marker across calls. */
export const sshCephDial: CephDial = async (node, argv) => {
  const nonce = randomBytes(8).toString('hex');
  const script = `${SUDO} -n -- ${quoteArgv(argv)}`;
  return runRemote(
    { connectTimeoutSec: CONNECT_TIMEOUT_SEC, execTimeoutMs: EXEC_TIMEOUT_MS, host: node },
    nonce,
    script,
  );
};

export type CephTransportOptions = {
  /** TB4 mon ssh destinations, tried in this order. Required; at least one. */
  readonly nodes: readonly string[];
  readonly dial?: CephDial;
  /** One line per attempted argv, before it dials. @default a line on stderr */
  readonly log?: (line: string) => void;
};

const defaultLog = (line: string) => process.stderr.write(`${line}\n`);

/**
 * Run one allowed ceph shape against the first mon that answers.
 *
 * ⛔ THE ALLOWLIST CHECK HAPPENS BEFORE THE FIRST NODE IS EVEN TRIED — a refused argv dials no
 *   ssh at all, so a bug that builds a bad shape cannot leak so much as a connection attempt.
 */
export const runCephCommand = async (
  options: CephTransportOptions,
  argv: readonly string[],
): Promise<CephExecResult & { readonly node: string }> => {
  const problem = cephCommandProblem(argv);
  if (problem !== undefined) {
    throw new SudoRefusedError(`ceph transport refused ${JSON.stringify(argv)}: ${problem}`);
  }
  if (options.nodes.length === 0) throw new Error('ceph transport: no mon nodes were declared');
  const dial = options.dial ?? sshCephDial;
  const log = options.log ?? defaultLog;
  const attempts: { readonly node: string; readonly message: string }[] = [];
  for (const node of options.nodes) {
    log(`homeflare/ceph sudo -n ${JSON.stringify(argv)} @ ${node}`);
    try {
      const result = await dial(node, argv);
      return { ...result, node };
    } catch (cause) {
      attempts.push({ message: cause instanceof Error ? cause.message : String(cause), node });
    }
  }
  // ⛔ NEVER "ABSENT". Every mon this call knew about failed at the transport layer; that is a
  //   down anchor (or a network problem), not proof the entity does not exist.
  const detail = attempts.map((a) => `${a.node}: ${a.message}`).join('; ');
  throw new Error(`ceph transport: every mon node failed (never treated as absent) — ${detail}`);
};

/**
 * ★ LOCKOUT SAFETY, THE UFW-ESTABLISHED PATTERN: after every write, re-check quorum on a FRESH
 *   connection (a new dial, never the one the write used) and fail the row if it degraded. Never
 *   auto-repair, never continue — the caller's write is reported as failed even though it may
 *   itself have succeeded, because a write that broke quorum is not a success this transport will
 *   call one.
 * ⚠️ THE SHAPE OF `quorum_status -f json` IS REASONED FROM PUBLIC CEPH DOCS, NOT MEASURED against
 *   this estate's Ceph release — there is no mon yet. An unparseable or missing `quorum` array
 *   fails closed as "degraded", never as "healthy"; see ceph-auth-parse.ts.
 */
export const assertFreshQuorum = async (options: CephTransportOptions): Promise<void> => {
  const result = await runCephCommand(options, quorumStatusArgv());
  if (result.exitCode !== 0) {
    throw new Error(
      `ceph quorum_status failed after a write (mon ${result.node}): ` +
        `${result.stderr.trim().slice(0, 300)}`,
    );
  }
  const quorum = parseQuorumStatus(result.stdout);
  if (!quorum.healthy) {
    throw new Error(
      `ceph quorum degraded after a write (mon ${result.node}): ${quorum.reason} — the write is ` +
        'reported as failed even if it landed; nothing here auto-repairs a quorum problem.',
    );
  }
};
