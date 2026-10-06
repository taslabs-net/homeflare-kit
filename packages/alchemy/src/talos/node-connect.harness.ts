/**
 * Run UNDER NODE by `node-connect.test.ts` (never imported by bun): a successful `talos-openbao`
 * connect with a fake `bao` and a fake apiserver, so any Bun-only API on the connect path (the
 * `Bun.YAML` that once made every kubeconfig "unreadable" on Node) fails CI.
 *
 * ★ The apiserver fake patches `node:https`'s `request` and calls `syncBuiltinESMExports`, which is
 *   how a Node program changes what `import * as https` sees. Prints one JSON line, no secrets.
 */
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { ClusterAdapter } from 'alchemy/Kubernetes/ClusterAdapter';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { TalosOpenBaoAdapter, talosOpenBaoConnection } from './cluster-adapter.ts';
import { fakeSpawner } from './fake-process.ts';

const b64 = (text: string) => Buffer.from(text).toString('base64');
const pem = (label: string) => `-----${'BEGIN'} ${label}-----\n${b64(label)}\n`;
const kubeconfig = `apiVersion: v1
kind: Config
clusters:
  - name: c1
    cluster: { server: 'https://c1.cluster.invalid:6443', certificate-authority-data: ${b64(pem('CERTIFICATE'))} }
contexts:
  - name: admin@c1
    context: { cluster: c1, user: admin@c1 }
users:
  - name: admin@c1
    user: { client-certificate-data: ${b64(pem('CERTIFICATE'))}, client-key-data: ${b64(pem('PRIVATE KEY'))} }
`;

const seen: string[] = [];
const fakeRequest = (
  options: { hostname: string; method: string; path: string },
  callback: (response: EventEmitter & { statusCode?: number }) => void,
) => {
  seen.push(`${options.method} ${options.hostname}${options.path}`);
  const request = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
  request.write = () => undefined;
  request.end = () => {
    const response = new EventEmitter() as EventEmitter & { statusCode?: number };
    response.statusCode = 200;
    callback(response);
    response.emit('data', Buffer.from('{"metadata":{"uid":"uid-c1"}}'));
    response.emit('end');
  };
  return request;
};
(https as unknown as { request: unknown }).request = fakeRequest;
syncBuiltinESMExports();

process.env['BAO_ADDR'] ??= 'https://bao.invalid';
process.env['BAO_TOKEN'] ??= 'fake-test-token';

// ⚠️ The trust-boundary seam registers the fixtures dir ASYNC (trust-boundary.ts's computed
//   dynamic import). `readKvValue` now vets `bao`, so the walk must see the boundary before it
//   runs. Awaiting the seam here flushes that registration; without it a bare `node` run can walk
//   past the (755) fixtures dir into a group-writable ancestor and refuse a trusted stub.
await import('./trust-boundary.seam.ts');

const spawner = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  fakeSpawner(() => ({ stdout: JSON.stringify({ data: { data: { kubeconfig } } }) })),
);
const config = {
  c1: { context: 'admin@c1', key: 'kubeconfig', mount: 'talos-c1', uid: 'uid-c1' },
};

const transport = await Effect.runPromise(
  Effect.gen(function* () {
    const adapter = yield* ClusterAdapter('talos-openbao');
    return yield* adapter.connect(talosOpenBaoConnection('uid-c1'));
  }).pipe(Effect.provide(TalosOpenBaoAdapter(config).pipe(Layer.provide(spawner)))),
);
const hasCert = transport.clientCert !== undefined;
process.stdout.write(`${JSON.stringify({ endpoint: transport.endpoint, hasCert, seen })}\n`);
