/**
 * Where sudo-runner.ts puts a file's bytes before `install` copies them into a fresh temp file
 * that `mv` then renames into place. The Linux twin of `../launchd/sudo-stage.ts` — rewritten,
 * not reused, because staging happens ON THE REMOTE HOST through the base runner's own calls,
 * never through `node:fs` against this process's local disk.
 *
 * ★ WHY STAGE AT ALL. The operator cannot write inside a root-owned directory, and the bytes must
 *   not travel through argv (they would reach the log and `ps`). So they are written, as the
 *   operator, to a private file on the SAME host, and `install` copies that one file.
 * ⛔ A 0700 DIRECTORY, A 0600 FILE: between the write and the install, nobody but the operator and
 *   root can read the bytes or swap the file. `mktemp -d` creates its directory 0700 by
 *   construction (GNU coreutils); the payload's own mode is asked for explicitly.
 */
import type { HostRunner } from '../launchd/runner.ts';

/** A file staged for `install`, and how to remove it again. */
export type Staged = { readonly path: string; readonly dispose: () => Promise<void> };

const refuse = (message: string): Error => new Error(`sshSudoRunner stage: ${message}`);

/** `stage` in `SshSudoDeps` — closes over the base runner so every call writes to the same host. */
export const stageRemote =
  (base: HostRunner) =>
  async (bytes: Uint8Array): Promise<Staged> => {
    const made = await base.exec(['mktemp', '-d']);
    if (made.exitCode !== 0)
      throw refuse(`mktemp -d -> ${String(made.exitCode)}: ${made.stderr.trim()}`);
    const dir = made.stdout.trim();
    if (dir === '' || !dir.startsWith('/')) {
      throw refuse(`mktemp -d printed ${JSON.stringify(made.stdout)}, not an absolute path`);
    }
    const dispose = async () => {
      const removed = await base.exec(['rm', '-rf', '--', dir]);
      // ⚠️ Best-effort: a leaked 0700 temp dir the operator owns is a nuisance, never a secret
      //   exposure, so disposal failing never masks the write's own success or failure.
      if (removed.exitCode !== 0) {
        process.stderr.write(
          `sshSudoRunner: could not remove staging dir ${dir}: ${removed.stderr.trim()}\n`,
        );
      }
    };
    try {
      const path = `${dir}/staged`;
      await base.writeFileAtomic(path, bytes, { mode: 0o600 });
      return { dispose, path };
    } catch (cause) {
      await dispose();
      throw cause;
    }
  };
