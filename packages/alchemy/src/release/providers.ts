/**
 * The release-binary provider with ONE HostRunner and its own HTTP client, as a single layer for a
 * host stack:
 *
 *     const runner = localRunner();
 *     Layer.mergeAll(launchdProviders(runner), releaseProviders(runner), …the stack's others)
 *
 * ★ PASS THE SAME RUNNER THE JOBS USE, so the binary and the daemon that runs it are written by one
 *   identity on one host — a stack cannot install as one user and bootstrap as another by accident.
 * ⛔ THERE IS NO DEFAULT RUNNER. A binary is written wherever the runner reaches; a silent default to
 *   "this machine" would install a Mac's daemons onto whichever laptop ran the deploy (the same
 *   reasoning as linuxProviders()).
 * ★ `FetchHttpClient.layer` IS PROVIDED HERE, not left to the stack: the Mac host stack this exists
 *   for provides no HTTP layer, and a missing one fails only at the first install.
 */
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { type HostRunner, hostRunnerLayer } from '../launchd/runner.ts';
import { ReleaseBinaryProvider } from './binary.ts';

export const releaseProviders = (runner: HostRunner) =>
  ReleaseBinaryProvider().pipe(
    Layer.provide(Layer.mergeAll(hostRunnerLayer(runner), FetchHttpClient.layer)),
  );
