/**
 * The "as root" half of fake-sudo.ts: what each allowlisted program does against the SAME
 * in-memory host `fake-linux-host.ts` builds, once `/usr/bin/sudo` has decided to run it.
 *
 * ⛔ TEST-ONLY, like fake-linux-host.ts: no provider imports it, it is not on the barrel.
 * ★ CHOWN AND MKDIR ARE HANDLED HERE, NOT BY DELEGATING TO `fake.runner.exec()` — the fake's own
 *   `chown` refuses when its FIXED `root` flag is false (which it is: the base host models an
 *   unprivileged operator), and `mkdir`/`chmod`/`rmdir` do not check ownership at all. Only a
 *   handler that writes `fake.dirs` / `fake.modes` / `fake.files` directly proves the runner's
 *   OWN allowlist and guard are what gate root, not a permission check the fake happens to have.
 * ★ INSTALL AND MV READ AND WRITE `fake.files` DIRECTLY TOO, because the staged file the operator
 *   wrote (via `stageRemote`'s ordinary `writeFileAtomic`) already lives there — there is no
 *   separate "staged bytes" side-channel to model, unlike the Mac fake's local temp files.
 */
import type { ExecResult, FileStat } from '../launchd/runner.ts';
import { CHMOD, CHOWN, INSTALL, MKDIR, MV, RM, RMDIR, SYSTEMCTL_ABS } from './sudo-allowlist.ts';
import type { fakeLinuxHost } from './fake-linux-host.ts';

type Fake = ReturnType<typeof fakeLinuxHost>;

/** What a test can force `sudo`'s next `mv` to answer instead of actually moving anything. */
export type RootState = { mvFailure?: ExecResult };

const ok = (stdout = ''): ExecResult => ({ exitCode: 0, stderr: '', stdout });
const fail = (exitCode: number, stderr: string): ExecResult => ({ exitCode, stderr, stdout: '' });
const parent = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/';

const applyOwner = (live: { uid: number; gid: number }, owner: string): void => {
  const [uidPart, gidPart] = owner.includes(':') ? owner.split(':') : [owner, undefined];
  if (uidPart !== undefined && uidPart !== '') live.uid = Number(uidPart);
  if (gidPart !== undefined && gidPart !== '') live.gid = Number(gidPart);
};

const dirRoot = (fake: Fake, argv: readonly string[]): ExecResult | undefined => {
  const [program, ...args] = argv;
  if (program === MKDIR) {
    const [, mode, , path] = args;
    if (path === undefined) return fail(1, 'mkdir: missing operand');
    fake.dirs.set(path, 0);
    fake.modes.set(path, { gid: 0, mode: Number.parseInt(mode ?? '755', 8), uid: 0 });
    return ok();
  }
  if (program === CHMOD) {
    const [mode, , path] = args;
    const live = path === undefined ? undefined : fake.modes.get(path);
    if (live === undefined) return fail(1, `chmod: ${String(path)}: No such file or directory`);
    live.mode = Number.parseInt(mode ?? '755', 8);
    return ok();
  }
  if (program === CHOWN) {
    const [owner, , path] = args;
    const live = path === undefined ? undefined : fake.modes.get(path);
    if (live === undefined || owner === undefined) {
      return fail(1, `chown: ${String(path)}: No such file or directory`);
    }
    applyOwner(live, owner);
    return ok();
  }
  if (program === RMDIR) {
    const [, path] = args;
    if (path === undefined || !fake.dirs.has(path)) {
      return fail(1, `rmdir: '${String(path)}': No such file or directory`);
    }
    if ([...fake.files.keys()].some((file) => parent(file) === path)) {
      return fail(1, `rmdir: failed to remove '${path}': Directory not empty`);
    }
    fake.dirs.delete(path);
    fake.modes.delete(path);
    return ok();
  }
  return undefined;
};

const fileRoot = (
  fake: Fake,
  argv: readonly string[],
  state: RootState,
): ExecResult | undefined => {
  const [program, ...args] = argv;
  if (program === INSTALL) {
    const tIndex = args.indexOf('-T');
    const [source, dest] = args.slice(-2);
    const ids = args.slice(2, tIndex);
    const owned = ids.includes('-o') ? Number(ids[ids.indexOf('-o') + 1]) : 0;
    const grouped = ids.includes('-g') ? Number(ids[ids.indexOf('-g') + 1]) : 0;
    const bytes = source === undefined ? undefined : fake.files.get(source)?.bytes;
    if (bytes === undefined || dest === undefined) {
      return fail(1, `install: cannot stat '${String(source)}': No such file or directory`);
    }
    const kind: FileStat['kind'] = 'file';
    fake.files.set(dest, {
      bytes,
      gid: grouped,
      kind,
      mode: Number.parseInt(args[1] ?? '644', 8),
      uid: owned,
    });
    return ok();
  }
  if (program === MV) {
    if (state.mvFailure !== undefined) {
      const failure = state.mvFailure;
      delete state.mvFailure; // ★ once, like a real transient failure — not every mv after it
      return failure;
    }
    const [source, dest] = args.slice(-2);
    const entry = source === undefined ? undefined : fake.files.get(source);
    if (entry === undefined || dest === undefined) {
      return fail(1, `mv: cannot stat '${String(source)}': No such file or directory`);
    }
    fake.files.delete(source ?? '');
    fake.files.set(dest, entry);
    return ok();
  }
  if (program === RM) {
    const [, , path] = args;
    if (path !== undefined) fake.files.delete(path);
    return ok();
  }
  return undefined;
};

/** Everything `/usr/bin/sudo -n --` may run, dispatched as root against the same fake host. */
export const asRoot = async (
  fake: Fake,
  argv: readonly string[],
  state: RootState = {},
): Promise<ExecResult> => {
  const dir = dirRoot(fake, argv);
  if (dir !== undefined) return dir;
  const file = fileRoot(fake, argv, state);
  if (file !== undefined) return file;
  if (argv[0] === SYSTEMCTL_ABS) return fake.runner.exec(['systemctl', ...argv.slice(1)]);
  return fail(1, `sudo: ${String(argv[0])}: command not found`);
};
