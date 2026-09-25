/**
 * The directory a read may stat.
 *
 * ⛔ A `creating` ROW CAN HAVE NO PATH. With `path: Output.interpolate`, Apply commits the row
 *   while the path is still an Output, so the next plan's recovery read is asked with `path`
 *   missing. `runner.stat` of that value throws `path must be a string` and the plan never
 *   finishes — the same brick `binary-read.ts` already closes for `Release.Binary`. A recovery
 *   (`recovering`) returns undefined and the create is re-driven. A probe with a missing path
 *   still fails, as a message, before any host call.
 */
import type { HostRunner } from '../launchd/runner.ts';
import { type HostDirectoryAttributes, readDirectory } from './directory-lifecycle.ts';

export const readInterruptedDirectory = (
  runner: HostRunner,
  path: unknown,
  recovering: boolean,
): Promise<HostDirectoryAttributes | undefined> => {
  if (typeof path !== 'string') {
    if (recovering) return Promise.resolve(undefined);
    return Promise.reject(new Error('Host.Directory path must be a string'));
  }
  return readDirectory(runner, path);
};
