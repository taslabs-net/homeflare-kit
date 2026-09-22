/**
 * Every provider in this subpath with ONE HostRunner, as a single layer for a host stack.
 *
 *     const runner = await sshRunner({ host: 'the-host' });
 *     Layer.mergeAll(linuxProviders(runner), …the stack's other providers)
 *
 * ★ ONE RUNNER FOR ALL OF THEM, so a directory, the config file inside it and the unit that reads
 *   that file are written by the same identity on the same host — a stack cannot create the
 *   directory on one host and start the unit on another by accident.
 * ⛔ THERE IS NO DEFAULT. launchdProviders() defaults to localRunner() because a Mac stack runs on
 *   the Mac it declares; a Linux host is somewhere else, and a silent default to "this machine"
 *   would write the estate's `/etc/systemd/system` onto the laptop running the deploy.
 */
import * as Layer from 'effect/Layer';
import { type HostRunner, hostRunnerLayer } from '../launchd/runner.ts';
import { HostDirectoryProvider } from './directory.ts';
import { RemoteFileProvider } from './remote-file.ts';
import { SystemdTimerProvider, SystemdUnitProvider } from './unit.ts';

export const linuxProviders = (runner: HostRunner) =>
  Layer.mergeAll(
    HostDirectoryProvider(),
    RemoteFileProvider(),
    SystemdTimerProvider(),
    SystemdUnitProvider(),
  ).pipe(Layer.provide(hostRunnerLayer(runner)));
