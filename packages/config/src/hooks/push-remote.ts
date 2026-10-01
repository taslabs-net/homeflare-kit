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
 * ⛔ A DESTINATION THAT CANNOT BE ASKED WIDENS, NEVER NARROWS: `undefined` means "could not
 *   ask" — a failure or the timeout below — and the caller then excludes nothing and scans
 *   every commit reachable from the pushed tips.
 * ⛔ ONLY THAT DESTINATION. The URL git passes the pre-push hook (githooks(5), the second
 *   argument) is the only address asked. `git ls-remote <remote name>` uses the fetch URL.
 *   When `remote.<name>.pushurl` differs from `url`, the fetch side can advertise commits the
 *   push destination lacks; excluding them publishes a secret the destination has never seen.
 *   Measured 2026-10-01. There is no fallback.
 * ⚠️ NO PROMPT, AND A TIMEOUT. The hook runs mid-push with a pipe on stdin; a credential prompt
 *   from a second connection would hang it, so `GIT_TERMINAL_PROMPT=0` makes it fail and widen.
 *   A timeout is the same failure (Bun reports exit 143, SIGTERM — measured 2026-10-01): no
 *   tips, and the partial stdout is discarded.
 */
import { withoutGitEnv } from './report.ts';

/** How long to wait for the destination to list its refs before scanning wider. */
const ASK_MS = 20_000;

/**
 * Repository-locating variables, and only those, dropped before `git ls-remote`.
 *
 * ★ THE LIST IS `git help git` FOR THE INSTALLED GIT, NOT A GUESS. `git version` here is
 *   2.47.3; `git help git`, ENVIRONMENT VARIABLES, section "The Git Repository", names
 *   exactly these twelve. They locate the repository git operates on. A hook exports
 *   `GIT_DIR` (report.ts); leaving it set makes `-C` talk to the hook's repository. Every
 *   other `GIT_*` stays. That is what carries the transport and the config git handed the
 *   hook: `GIT_SSH`, `GIT_SSH_COMMAND`,
 *   `GIT_SSH_VARIANT`, `GIT_ASKPASS`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`,
 *   `GIT_CONFIG_KEY_*`, `GIT_CONFIG_VALUE_*`. Measured 2026-10-01 on git 2.47.3: a `git -c`
 *   push puts that `-c` in `GIT_CONFIG_PARAMETERS` (`GIT_CONFIG_COUNT` stayed unset).
 *   Stripping the block made `ls-remote` of the real push URL fail and the fetch-URL
 *   fallback exclude a commit the destination did not have.
 */
const REPO_LOCATING: ReadonlySet<string> = new Set([
  'GIT_INDEX_FILE',
  'GIT_INDEX_VERSION',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_COMMON_DIR',
  'GIT_DEFAULT_HASH',
  'GIT_DEFAULT_REF_FORMAT',
]);

/** The hook environment minus the repository-locating variables, and no credential prompt. */
function remoteAskEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || REPO_LOCATING.has(name)) continue;
    env[name] = value;
  }
  env['GIT_TERMINAL_PROMPT'] = '0';
  return env;
}

export type GitResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Run git at `root`, capturing both streams.
 * `transport` keeps the transport and config environment for `ls-remote` — see `remoteAskEnv`.
 * Otherwise the hook's inherited `GIT_*` is dropped.
 */
export async function gitAt(
  root: string,
  args: readonly string[],
  options: { stdin?: string; timeoutMs?: number; transport?: boolean } = {},
): Promise<GitResult> {
  const proc = Bun.spawn(['git', '-C', root, ...args], {
    env: options.transport ? remoteAskEnv() : withoutGitEnv(),
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
 * Ask `destination` — the URL the pre-push hook was given, and nothing else — which refs it has.
 * A missing URL, a non-zero exit, or a timeout is "could not ask": no tips, no exclusion.
 */
export async function knownRemoteTips(
  root: string,
  destination: string | undefined,
): Promise<RemoteTips> {
  if (destination === undefined || destination === '') return { tips: [], via: undefined };
  const listed = await gitAt(root, ['ls-remote', destination], {
    transport: true,
    timeoutMs: ASK_MS,
  });
  if (listed.code !== 0) return { tips: [], via: undefined };
  const advertised = lines(listed.stdout)
    .map((line) => line.split('\t')[0] ?? '')
    .filter((hash) => /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(hash));
  return {
    tips: await localIndependentTips(root, [...new Set(advertised)]),
    via: destination,
  };
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
