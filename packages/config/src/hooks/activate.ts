/**
 * Turn the hooks on for a clone and EVERY worktree of it, from `prepare`.
 *
 * 🔴 THE GAP THIS CLOSES, measured 2026-09-23. husky sets `core.hooksPath=.husky/_`, and
 *   `.husky/_` is generated and gitignored: it exists only in the worktree where `bun
 *   install` ran husky. `core.hooksPath` lives in the clone's SHARED config, so every other
 *   worktree — every `git worktree add` an agent makes — points at a directory it does not
 *   have, and git runs no hooks there, silently. In homeflare-kit that was every worktree
 *   until `bun install` had run husky inside it.
 * ★ THE FIX IS A TRACKED PATH. `core.hooksPath=.husky` is relative, and git resolves a
 *   relative hooks path against the worktree running the hook — so each worktree runs its
 *   OWN checked-out `.husky/`, present from the moment the worktree exists. Measured on git
 *   2.55: a fresh `git worktree add` ran the tracked hook with no install at all. (The
 *   wrapper then needs that worktree's `node_modules` to do its work — install.ts says so
 *   out loud rather than failing.)
 * ⛔ IT NEVER FAILS. `prepare` runs inside `bun install`; a hook problem must not break an
 *   install. Every outcome, including "did nothing", is a message and exit 0.
 */
import { probe } from './report.ts';

export type Activation = {
  /** The hooks path is set (now or already). */
  readonly active: boolean;
  readonly message: string;
};

/**
 * ⚠️ CI IS SKIPPED ON PURPOSE. Hooks are a local convenience and CI runs the real gate; a
 *   runner with hooks on would run them on the commits it makes itself (a release's
 *   "Version Packages" commit) on a machine that may have no gitleaks.
 */
function inCi(env: Readonly<Record<string, string | undefined>>): boolean {
  const ci = env['CI'];
  return ci !== undefined && ci !== '' && ci !== '0' && ci.toLowerCase() !== 'false';
}

export async function activateHooks(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Activation> {
  if (inCi(env)) return { active: false, message: 'CI is set — hooks stay off; CI runs the gate' };

  // ★ `--show-prefix` answers two questions at once: whether this is a work tree at all
  //   (it fails outside one — a tarball install), and where `root` sits inside it.
  const where = await probe(['git', '-C', root, 'rev-parse', '--show-prefix']);
  if (where.code !== 0) return { active: false, message: 'not a git work tree — nothing to do' };

  const tracked = await Promise.all(
    ['pre-commit', 'pre-push'].map((name) => Bun.file(`${root}/.husky/${name}`).exists()),
  );
  if (!tracked.some(Boolean)) {
    return { active: false, message: 'no .husky/pre-commit or .husky/pre-push to point git at' };
  }

  // ⚠️ RELATIVE TO THE TOP OF THE WORK TREE, which is where git resolves it — a package
  //   below the root (`<prefix>.husky`) still points at its own directory.
  const want = `${where.stdout.trim()}.husky`;
  const current = (
    await probe(['git', '-C', root, 'config', '--get', 'core.hooksPath'])
  ).stdout.trim();
  if (current === want) return { active: true, message: `core.hooksPath is already ${want}` };

  // ★ NO `--worktree`: the clone's shared config, so ONE install covers every worktree.
  const set = await probe(['git', '-C', root, 'config', 'core.hooksPath', want]);
  if (set.code !== 0) return { active: false, message: 'git config core.hooksPath failed' };
  const was = current === '' ? 'unset' : current;
  return {
    active: true,
    message: `core.hooksPath ${was} → ${want}, for every worktree of this clone`,
  };
}
