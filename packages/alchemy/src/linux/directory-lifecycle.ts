/**
 * HostDirectory's props, validation and lifecycle over a HostRunner.
 *
 * ★ WHY IT EXISTS AT ALL. `Host.File` and `Remote.File` both refuse to create a parent directory,
 *   on purpose — creating one would invent an owner and a mode nobody declared. The consequence is
 *   that a first deploy into a new tree fails on its first file. This resource is the declaration
 *   that was missing, not a convenience flag on the file.
 * ⛔ ONE DIRECTORY, NEVER A CHAIN. A missing parent is a refusal that names it, so a tree is a
 *   chain of declarations whose modes and owners are all visible in the plan. `mkdir -p` would
 *   create the intermediate levels at whatever umask the deploy happened to run with.
 * ⛔ DELETE IS `rmdir`, NEVER RECURSIVE. A directory that still holds files is a refusal: removing
 *   a declaration must not be able to remove data the declaration never mentioned.
 */
import type { Diff } from 'alchemy/Diff';
import { pathProblems } from '../launchd/host-file-form.ts';
import { type HostRunner, canActAsRoot } from '../launchd/runner.ts';

export interface HostDirectoryProps {
  /** Absolute path. ⚠️ Its parent must already exist — declare it as another HostDirectory. */
  path: string;
  /** Permission bits. @default 0o755 */
  mode?: number;
  /** User name or numeric uid. Omitted: whoever the runner writes as. */
  owner?: string | number;
  /** Group name or numeric gid. Omitted: the parent's default group. */
  group?: string | number;
}

export interface HostDirectoryAttributes {
  path: string;
  mode: number;
  uid: number;
  gid: number;
}

export const DEFAULT_DIR_MODE = 0o755;

export const refuse = (path: string, message: string): Error =>
  new Error(`Host.Directory ${path}: ${message}`);

const idProblems = (name: string, value: string | number | undefined): string[] => {
  if (value === undefined) return [];
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? [] : [`${name} must be a non-negative id`];
  }
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value) || /^\d+$/.test(value)
    ? []
    : [`${name} ${JSON.stringify(value)} is not a valid user or group name`];
};

export const directoryProblems = (props: HostDirectoryProps): string[] => {
  const found = pathProblems(props.path);
  const mode = props.mode ?? DEFAULT_DIR_MODE;
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) found.push('mode must be 0–0o7777');
  found.push(...idProblems('owner', props.owner), ...idProblems('group', props.group));
  return found;
};

const numericId = (value: string | number): number | undefined =>
  typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : undefined;

type Desired = { readonly mode: number; readonly uid?: number; readonly gid?: number };

const desired = async (runner: HostRunner, props: HostDirectoryProps): Promise<Desired> => {
  const found = directoryProblems(props);
  if (found.length > 0) throw refuse(props.path, found.join('; '));
  let uid: number | undefined;
  let gid: number | undefined;
  if (props.owner !== undefined) {
    uid = numericId(props.owner) ?? (await runner.lookupUser(String(props.owner)))?.uid;
    if (uid === undefined) throw refuse(props.path, `no user ${String(props.owner)} on this host`);
  }
  if (props.group !== undefined) {
    gid = numericId(props.group) ?? (await runner.lookupGroup(String(props.group)));
    if (gid === undefined) throw refuse(props.path, `no group ${String(props.group)} on this host`);
  }
  return {
    mode: props.mode ?? DEFAULT_DIR_MODE,
    ...(uid === undefined ? {} : { uid }),
    ...(gid === undefined ? {} : { gid }),
  };
};

export const readDirectory = async (
  runner: HostRunner,
  path: string,
): Promise<HostDirectoryAttributes | undefined> => {
  const stat = await runner.stat(path);
  if (stat === undefined || stat.kind !== 'directory') return undefined;
  return { gid: stat.gid, mode: stat.mode, path, uid: stat.uid };
};

const octal = (mode: number) => mode.toString(8).padStart(3, '0');

/** One program, checked: anything but exit 0 is an Error naming the argv and the host's words. */
const must = async (runner: HostRunner, path: string, argv: readonly string[]): Promise<void> => {
  const result = await runner.exec(argv);
  if (result.exitCode !== 0) {
    throw refuse(
      path,
      `${argv.join(' ')} -> ${String(result.exitCode)}: ${result.stderr.trim().slice(0, 300)}`,
    );
  }
};

/**
 * Create it when absent, then bring mode and ownership to the declaration and read back.
 * ⚠️ `mkdir -m` sets the mode with chmod(2) after mkdir(2), so it is exact — plain `mkdir` would
 *   mask the declared bits through the deploying shell's umask and the drift would return forever.
 */
export const reconcileDirectory = async (
  runner: HostRunner,
  props: HostDirectoryProps,
  output?: HostDirectoryAttributes,
  adopt = false,
): Promise<HostDirectoryAttributes> => {
  const want = await desired(runner, props);
  if (want.uid !== undefined && want.uid !== runner.effectiveUid() && !canActAsRoot(runner)) {
    throw refuse(
      props.path,
      `owner ${String(props.owner)} is not the deploying user; only root may chown. Deploy through ` +
        'a root destination or a privileged HostRunner. This provider never calls sudo itself.',
    );
  }
  const stat = await runner.stat(props.path);
  if (stat !== undefined && stat.kind !== 'directory') {
    throw refuse(props.path, `is a ${stat.kind}, not a directory`);
  }
  /**
   * ⛔ A DIRECTORY THIS RESOURCE DOES NOT OWN IS NEVER RE-MODED. Where the engine's probe never
   *   looked — a replace's new path, a create whose props were still an Output — an existing
   *   directory with a different mode or owner is someone else's. ★ Adoption takes it over.
   */
  if (output === undefined && stat !== undefined && !adopt) {
    const drifted = stat.mode !== want.mode || (want.uid !== undefined && stat.uid !== want.uid);
    if (drifted) {
      throw refuse(
        props.path,
        'already exists with another mode or owner and is not this resource. Remove it, or ' +
          'declare it as a new resource and deploy with --adopt.',
      );
    }
  }
  if (stat === undefined) {
    const parent = props.path.slice(0, props.path.lastIndexOf('/')) || '/';
    const above = await runner.stat(parent);
    if (above === undefined || above.kind !== 'directory') {
      throw refuse(props.path, `its parent ${parent} does not exist; declare that directory too`);
    }
    await must(runner, props.path, ['mkdir', '-m', octal(want.mode), '--', props.path]);
  } else if (stat.mode !== want.mode) {
    await must(runner, props.path, ['chmod', octal(want.mode), '--', props.path]);
  }
  /**
   * ★ Only when it is actually wrong. A `chown` that changes nothing is still a write on the host
   *   and a line in the deploy log, and "a converged resource is not touched" is the rule this
   *   whole family is judged by.
   */
  const owner = ownerMatches(
    { gid: stat?.gid ?? -1, mode: 0, path: props.path, uid: stat?.uid ?? -1 },
    want,
  )
    ? undefined
    : ownerArg(want);
  if (owner !== undefined) await must(runner, props.path, ['chown', owner, '--', props.path]);
  const after = await readDirectory(runner, props.path);
  // ⚠️ READ BACK: a runner that ignored the mode shows up here, not as a forever-`update`.
  if (after === undefined || after.mode !== want.mode || !ownerMatches(after, want)) {
    throw refuse(props.path, 'the directory on the host does not match the declaration');
  }
  return after;
};

/** ⛔ Never `<uid>:` — GNU chown reads a trailing colon as that user's LOGIN group, undeclared. */
const ownerArg = (want: Desired): string | undefined => {
  if (want.uid === undefined) return want.gid === undefined ? undefined : `:${String(want.gid)}`;
  return want.gid === undefined ? String(want.uid) : `${String(want.uid)}:${String(want.gid)}`;
};

const ownerMatches = (live: HostDirectoryAttributes, want: Desired): boolean =>
  (want.uid === undefined || live.uid === want.uid) &&
  (want.gid === undefined || live.gid === want.gid);

/**
 * ★ A plan that will write asks the runner first (`checkWrite`, when it has one) — a directory is
 *   created and chmod'd through `exec`, but a runner that refuses to touch the path at all should
 *   say so at plan time rather than mid-apply.
 */
export const diffDirectory = async (
  runner: HostRunner,
  news: HostDirectoryProps,
  output: HostDirectoryAttributes,
): Promise<Diff> => {
  const want = await desired(runner, news);
  if (news.path !== output.path) return { action: 'replace' };
  const live = await readDirectory(runner, news.path);
  // ⛔ BOTH: the live directory catches a hand chmod, the stored attributes catch a deploy that
  //   died after the mkdir and before its commit.
  const converged =
    live !== undefined &&
    live.mode === want.mode &&
    ownerMatches(live, want) &&
    output.mode === want.mode &&
    ownerMatches(output, want);
  if (converged) return { action: 'noop' };
  await runner.checkWrite?.(news.path, want);
  return { action: 'update' };
};

/** Remove it. ⛔ `rmdir`: a directory that still holds anything is a refusal, never a recursion. */
export const deleteDirectory = async (
  runner: HostRunner,
  output: HostDirectoryAttributes,
): Promise<void> => {
  const stat = await runner.stat(output.path);
  if (stat === undefined) return;
  if (stat.kind !== 'directory')
    throw refuse(output.path, `is now a ${stat.kind}; not removing it`);
  await must(runner, output.path, ['rmdir', '--', output.path]);
};
