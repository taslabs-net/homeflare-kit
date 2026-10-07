/**
 * Shared fixtures for the `Talos.Kubeconfig` tests: a fixture kubeconfig and the fake-spawner
 * runner.
 *
 * ⚠️ FIXTURES ONLY — see values.test.ts's own header for why the base64 fields are built from
 *   plain words at run time rather than written out literally.
 */
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import { type FakeCall, fakeSpawner } from './fake-process.ts';
import type { KubeconfigProps } from './kubeconfig.ts';

const b64 = (words: string) => Buffer.from(words).toString('base64');

export const fixtureKubeconfig = (marker: string) => `
apiVersion: v1
kind: Config
clusters:
  - name: hf-c1
    cluster:
      server: https://192.0.2.50:6443
      certificate-authority-data: ${b64(`not a ca ${marker}`)}
contexts:
  - name: admin@hf-c1
    context: { cluster: hf-c1, user: admin@hf-c1 }
users:
  - name: admin@hf-c1
    user:
      client-certificate-data: ${b64(`not a certificate ${marker}`)}
      client-key-data: ${b64(`not a key ${marker}`)}
current-context: admin@hf-c1
`;

const TARGET = { cluster: 'c1', mount: 'talos-c1' };
export const props = (): KubeconfigProps => ({
  context: 'admin@hf-c1',
  node: '198.51.100.10',
  target: TARGET,
});

export const run = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
  handler: (c: FakeCall) => { stdout?: string; stderr?: string; exitCode?: number },
  calls: FakeCall[] = [],
) =>
  Effect.runPromise(
    Effect.provideService(
      effect,
      ChildProcessSpawner.ChildProcessSpawner,
      fakeSpawner(handler, calls),
    ),
  );
