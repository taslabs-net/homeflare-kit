/**
 * HostFile's read / diff / reconcile / delete as plain async functions over a HostRunner, so the
 * lifecycle runs against fake-runner.ts in tests.
 *
 * ★ THE CONVERGENCE ITSELF IS file-converge.ts, shared with every resource that owns one whole file
 *   (Release.Binary is the second). What stays here is what makes a HOST FILE: text content, its
 *   validation (never a secret — host-file-form.ts), and the refusal wording `Host.File <path>: …`.
 * ⛔ SYMLINKS AND DIRECTORIES ARE REFUSED, NOT REPLACED — see file-converge.ts for why.
 */
import type { Diff } from 'alchemy/Diff';
import {
  type FileTarget,
  convergeFile,
  diffTarget,
  removeWholeFile,
  resolveIds,
} from './file-converge.ts';
import {
  DEFAULT_MODE,
  type HostFileAttributes,
  type HostFileProps,
  fileProblems,
} from './host-file-form.ts';
import { sha256Hex } from './job-form.ts';
import type { HostRunner } from './runner.ts';

export { readFileAttributes } from './file-converge.ts';

type Desired = FileTarget & { readonly bytes: Uint8Array };

const refuse = (path: string, message: string): Error => new Error(`Host.File ${path}: ${message}`);

/** Validate, then resolve owner/group names to ids through the runner. */
export const desiredFile = async (runner: HostRunner, props: HostFileProps): Promise<Desired> => {
  const found = fileProblems(props);
  if (found.length > 0) throw refuse(props.path, found.join('; '));
  const bytes = new TextEncoder().encode(props.content);
  return {
    bytes,
    mode: props.mode ?? DEFAULT_MODE,
    path: props.path,
    sha256: sha256Hex(bytes),
    ...(await resolveIds(runner, props, props.path, refuse)),
  };
};

/** Declared digest, mode and owner against state and the live file — see diffTarget. */
export const diffFile = async (
  runner: HostRunner,
  news: HostFileProps,
  output: HostFileAttributes,
): Promise<Diff> => diffTarget(runner, await desiredFile(runner, news), output);

/**
 * Write the declared text, unless the file already matches. `adopt` is adoptsAtApply's answer;
 * what it may and may not take over is convergeFile's ⛔.
 */
export const reconcileFile = async (
  runner: HostRunner,
  props: HostFileProps,
  output?: HostFileAttributes,
  adopt = false,
): Promise<HostFileAttributes> => {
  const want = await desiredFile(runner, props);
  const spec = { bytesFor: async () => want.bytes, owner: props.owner, refuse, want };
  return convergeFile(runner, spec, output, adopt);
};

/** Remove the file. Idempotent. ⛔ Refuses a path that has since become a symlink or directory. */
export const deleteFile = (runner: HostRunner, output: HostFileAttributes): Promise<void> =>
  removeWholeFile(runner, output, refuse);
