/**
 * What a remote already has, asked of the remote itself.
 *
 * ★ `git ls-remote`, NOT THE REMOTE-TRACKING REFS. `refs/remotes/<name>/*` is a cache of the last
 *   fetch, and every way it can be wrong makes the push scan LESS. Measured by the red team on
 *   2026-10-01: a secret pushed with hooks off to a branch that was later deleted on the remote,
 *   then fast-forward merged from the unpruned `origin/<branch>`, was excluded as "already on
 *   the remote" and published again with exit 0. The remote's own answer cannot be stale, and it
 *   is exact for a push by URL and for the first push to a remote this clone never fetched, where
 *   there are no tracking refs at all and the scan used to cover the whole history.
 * ⚠️ ONLY WHAT EXISTS LOCALLY CAN BE EXCLUDED, so the remote's hashes are filtered to commits
 *   this repository has, then reduced to the independent tips (`merge-base --independent`): a
 *   tip that is an ancestor of another adds nothing, and a hosted remote can advertise
 *   thousands of refs where a command line cannot carry them.
 * ⛔ A REMOTE THAT CANNOT BE ASKED WIDENS, NEVER NARROWS: `undefined` means "could not ask",
 *   and the caller then excludes nothing and scans everything.
 * ⚠️ NO PROMPT, AND A TIMEOUT. The hook runs mid-push with a pipe on stdin; a credential prompt
 *   from a second connection would hang it, so `GIT_TERMINAL_PROMPT=0` makes it fail and widen.
 */
import { withoutGitEnv } from './report.ts';

/** How long to wait for a remote to list its refs before giving up and scanning wider. */
const ASK_MS = 20_000;

export type GitResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** Run git at `root` with the hook's inherited `GIT_*` dropped, capturing both streams. */
export async function gitAt(
  root: string,
  args: readonly string[],
  options: { stdin?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<GitResult> {
  const proc = Bun.spawn(['git', '-C', root, ...args], {
    env: { ...withoutGitEnv(), ...options.env },
    stdin: options.stdin === undefined ? 'ignore' : new Blob([options.stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

const lines = (text: string): readonly string[] => text.split('\n').filter((line) => line !== '');

export type RemoteTips = {
  /** The remote's commits this repository also has, reduced to independent tips. */
  readonly tips: readonly string[];
  /** Which of the candidates answered; `undefined` when none could be asked. */
  readonly via: string | undefined;
};

/**
 * Ask each of `candidates` (the push URL git hands the hook, then the remote's name) which refs
 * it has, until one answers.
 * ★ THE URL FIRST: it is what is actually pushed to — a `pushurl` can differ from the fetch URL
 *   that `ls-remote <name>` would use.
 */
export async function knownRemoteTips(
  root: string,
  candidates: readonly string[],
): Promise<RemoteTips> {
  for (const candidate of candidates) {
    const listed = await gitAt(root, ['ls-remote', candidate], {
      env: { GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: ASK_MS,
    });
    if (listed.code !== 0) continue;
    const advertised = lines(listed.stdout)
      .map((line) => line.split('\t')[0] ?? '')
      .filter((hash) => /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(hash));
    return { tips: await localIndependentTips(root, [...new Set(advertised)]), via: candidate };
  }
  return { tips: [], via: undefined };
}

async function localIndependentTips(
  root: string,
  hashes: readonly string[],
): Promise<readonly string[]> {
  if (hashes.length === 0) return [];
  const checked = await gitAt(root, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    stdin: `${hashes.join('\n')}\n`,
  });
  const local = lines(checked.stdout)
    .filter((line) => line.endsWith(' commit'))
    .map((line) => line.split(' ')[0] ?? '');
  if (local.length <= 1) return local;
  const reduced = await gitAt(root, ['merge-base', '--independent', ...local]);
  return reduced.code === 0 ? lines(reduced.stdout) : local;
}
