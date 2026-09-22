/**
 * Both launchd-subpath providers with one HostRunner, as a single layer for a host stack.
 *
 *     Layer.mergeAll(launchdProviders(), …the stack's other providers)
 *
 * ★ ONE RUNNER FOR BOTH, so a daemon's config file (HostFile) and the daemon (LaunchdJob) are
 *   written by the same identity on the same host — a stack cannot write the file as one user and
 *   bootstrap the job as another by accident.
 * ⚠️ The default is localRunner(): this process, never elevated. A system-domain job therefore
 *   needs the deploy itself started as root, or a runner passed here with `privileged: true` —
 *   `launchdProviders(sudoRunner({ prefixes }))` is the kit's own (sudo-runner.ts).
 */
import * as Layer from 'effect/Layer';
import { HostFileProvider } from './host-file.ts';
import { LaunchdJobProvider } from './job.ts';
import { localRunner } from './local-runner.ts';
import { type HostRunner, hostRunnerLayer } from './runner.ts';

export const launchdProviders = (runner: HostRunner = localRunner()) =>
  Layer.mergeAll(LaunchdJobProvider(), HostFileProvider()).pipe(
    Layer.provide(hostRunnerLayer(runner)),
  );
