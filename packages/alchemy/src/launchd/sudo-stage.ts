/**
 * Where sudo-runner.ts puts a file's bytes before `install` copies them into place as root.
 *
 * ★ WHY STAGE AT ALL. The deploying user cannot write inside a root-owned directory, and the bytes
 *   must not travel through argv (they would reach the log and `ps`). So they are written, as the
 *   deploying user, to a private file, and `install` copies that one file.
 * ⛔ A 0700 DIRECTORY, A 0600 FILE, O_EXCL: between the write and the install, nobody but the
 *   deploying user and root can read the bytes or swap the file.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A file staged for `install`, and how to remove it again. */
export type Staged = { readonly path: string; readonly dispose: () => Promise<void> };

export const stageFile = async (bytes: Uint8Array): Promise<Staged> => {
  const dir = await mkdtemp(join(tmpdir(), 'hf-sudo-'));
  const dispose = () => rm(dir, { force: true, recursive: true });
  try {
    const path = join(dir, 'staged');
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    return { dispose, path };
  } catch (cause) {
    await dispose();
    throw cause;
  }
};
