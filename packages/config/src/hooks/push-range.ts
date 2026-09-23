/**
 * What a push changes: the base it is measured from, and the files between that base and
 * the commit being pushed.
 *
 * ★ THE BASE COMES FROM GIT, NOT FROM A GUESS. A pre-push hook reads
 *   `<local ref> <local sha> <remote ref> <remote sha>` on stdin. The remote sha is exactly
 *   "what the remote has now", so a second push to a branch checks only what is new.
 * 🔴 A BRANCH-NAME BASE IS VACUOUS ON THE BASE BRANCH. Measured in the house monorepo
 *   2026-09-08: `turbo --affected` compares against `main`, so on `main` itself it selected
 *   zero packages and a real two-commit push ran zero tests. Taking the base from stdin
 *   cannot do that — the remote sha is never the commit being pushed.
 * ⛔ AN UNKNOWN BASE WIDENS, IT NEVER NARROWS TO NOTHING. No merge base (a shallow clone, a
 *   rewritten history), no remote-tracking branch: every lane runs, tests in full. A gate
 *   whose base is unusable must do MORE work, never quietly run nothing.
 */
import { probe } from './report.ts';

/** One line of git's pre-push stdin. */
export type PushRef = {
  readonly localRef: string;
  readonly localSha: string;
  readonly remoteRef: string;
  readonly remoteSha: string;
};

export type PushScope =
  /** The push changes no file (a deletion, or a branch at its base): nothing to check. */
  | { readonly kind: 'empty'; readonly why: string }
  /** Measured from `base`: `changed` is every path that differs between it and the tip. */
  | {
      readonly kind: 'scoped';
      readonly base: string;
      readonly changed: readonly string[];
      readonly why: string;
    }
  /** No usable base: run every lane, tests in full. */
  | { readonly kind: 'unscoped'; readonly why: string }
  /** The pushed commit is not what is checked out, so the working tree cannot vouch for it. */
  | { readonly kind: 'elsewhere'; readonly why: string };

/** git's "no such ref" sentinel — 40 zeros (64 under SHA-256). */
const ZERO = /^0+$/;

export function parsePushRefs(stdin: string): readonly PushRef[] {
  const refs: PushRef[] = [];
  for (const line of stdin.split('\n')) {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (localRef && localSha && remoteRef && remoteSha) {
      refs.push({ localRef, localSha, remoteRef, remoteSha });
    }
  }
  return refs;
}

const short = (sha: string): string => sha.slice(0, 9);

async function ok(root: string, args: readonly string[]): Promise<boolean> {
  return (await probe(['git', '-C', root, ...args])).code === 0;
}

async function out(root: string, args: readonly string[]): Promise<string | undefined> {
  const result = await probe(['git', '-C', root, ...args]);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/**
 * The remote's default branch as a local ref: `<remote>/HEAD` when the clone recorded it,
 * else `<remote>/main`, else `<remote>/master`.
 * ⚠️ `refs/remotes/<remote>/HEAD` IS OFTEN ABSENT — `git clone` sets it, `git init` plus
 *   `git remote add` does not — so the fallbacks are the common path, not the rare one.
 */
async function defaultBranch(root: string, remote: string): Promise<string | undefined> {
  const head = await out(root, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`]);
  if (head !== undefined && head !== '') return head;
  for (const name of ['main', 'master']) {
    const ref = `refs/remotes/${remote}/${name}`;
    if (await ok(root, ['rev-parse', '--verify', '--quiet', ref])) return ref;
  }
  return undefined;
}

/**
 * Where the pushed commit is measured from.
 *
 * ★ A FAST-FORWARD IS MEASURED FROM THE REMOTE SHA — only what this push adds.
 * ⚠️ ANYTHING ELSE IS MEASURED FROM THE MERGE BASE WITH THE DEFAULT BRANCH: a new branch
 *   (zero remote sha), a remote sha this clone has not fetched, or a force-push after a
 *   rebase — where diffing against the old tip would drag in everything `main` gained since.
 */
async function baseFor(
  root: string,
  remote: string,
  ref: PushRef,
): Promise<{ base: string; why: string } | { why: string }> {
  const { localSha, remoteSha } = ref;
  if (
    !ZERO.test(remoteSha) &&
    (await ok(root, ['cat-file', '-e', `${remoteSha}^{commit}`])) &&
    (await ok(root, ['merge-base', '--is-ancestor', remoteSha, localSha]))
  ) {
    return { base: remoteSha, why: `since ${short(remoteSha)}, what ${remote} has now` };
  }
  const branch = await defaultBranch(root, remote);
  if (branch === undefined) return { why: `no ${remote}/main or ${remote}/master to measure from` };
  const mergeBase = await out(root, ['merge-base', localSha, branch]);
  if (mergeBase === undefined || mergeBase === '') {
    return { why: `no merge base with ${branch} (a shallow clone, or unrelated history)` };
  }
  const name = branch.replace(/^refs\/remotes\//, '');
  return { base: mergeBase, why: `since ${short(mergeBase)}, where this branch left ${name}` };
}

/**
 * Resolve the push git described on stdin. With no stdin (a manual run) the push is
 * `HEAD` to a new branch — measured from the merge base with the default branch.
 * 🔴 THE LANES RUN ON THE WORKING TREE, SO ONLY A PUSH OF `HEAD` CAN BE CHECKED HERE. Found
 *   in review 2026-09-23 and reproduced: `git push origin broken` from a clean `main`
 *   measured the right files, then ran `bun test --changed` against `main`'s tree, found
 *   nothing, and printed "passed". A ref that is not checked out now comes back
 *   `elsewhere`, which the caller reports as NOT CHECKED — never as a pass. (The old
 *   whole-`check` hook had the same blind spot; it just ran unrelated tests while in it.)
 * ⚠️ WITH SEVERAL REFS, THE ONE AT `HEAD` IS MEASURED and the rest are named as unchecked.
 */
export async function pushScope(
  root: string,
  remote: string,
  refs: readonly PushRef[],
): Promise<PushScope> {
  const pushed = refs.filter((ref) => !ZERO.test(ref.localSha));
  if (refs.length > 0 && pushed.length === 0) {
    return { kind: 'empty', why: 'this push only deletes refs' };
  }
  const head = await out(root, ['rev-parse', 'HEAD']);
  const atHead = pushed.find((ref) => ref.localSha === head);
  const others = pushed.filter((ref) => ref !== atHead).map((ref) => ref.localRef);
  if (pushed.length > 0 && atHead === undefined) {
    return {
      kind: 'elsewhere',
      why: `pushing ${others.join(', ')}, but the checkout is at ${short(head ?? '?')}`,
    };
  }
  const ref = atHead ?? {
    localRef: 'HEAD',
    localSha: head ?? 'HEAD',
    remoteRef: '',
    remoteSha: '0'.repeat(40),
  };
  const found = await baseFor(root, remote, ref);
  const also = others.length > 0 ? `; ${others.join(', ')} not checked here` : '';
  if (!('base' in found)) return { kind: 'unscoped', why: `${found.why}${also}` };

  const diff = await probe([
    'git',
    '-C',
    root,
    'diff',
    '--name-only',
    '-z',
    found.base,
    ref.localSha,
  ]);
  if (diff.code !== 0) return { kind: 'unscoped', why: `git diff ${short(found.base)} failed` };
  const changed = diff.stdout.split('\0').filter((path) => path !== '');
  if (changed.length === 0) return { kind: 'empty', why: `no file differs ${found.why}${also}` };
  return { kind: 'scoped', base: found.base, changed, why: `${found.why}${also}` };
}

/**
 * A path that changes what EVERY test runs on: a manifest, a lockfile, Bun's config, a
 * tsconfig. Bun's `--changed` follows imports and none of these is imported — measured
 * 2026-09-23, editing package.json selected 0 of 246 test files — so a push touching one
 * runs the tests in full rather than none of them.
 */
export function changesEverything(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  return /^(package\.json|bun\.lockb?|bunfig\.toml|tsconfig.*\.json)$/.test(name);
}
