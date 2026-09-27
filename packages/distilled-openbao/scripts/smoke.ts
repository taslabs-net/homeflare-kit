/**
 * Consumer smoke test: pack, install, and build a real request for one
 * operation — no live OpenBao call (this package must never touch a real
 * vault, house policy or otherwise), but a real `HttpClientRequest` the
 * SDK's protocol layer produced from the generated operation, credentials
 * and traits, exactly as it would for a genuine call.
 *
 * `policiesReadAclPolicy` (`GET /sys/policies/acl/{name}`) is the operation
 * this package's first kit consumer (Bao.Policy) will call, and its
 * `PolicyNotFound` tag is the one typed error this SDK declares so far — see
 * ../README.md and ../../alchemy/docs/distilled-interim.md.
 *
 * A second check feeds back the canned, measured 404 shape
 * (`{"errors":[]}` — OpenBao 2.6.2, no message text) and asserts it decodes
 * to `PolicyNotFound`, proving the typed-error wiring (patch -> generated
 * `errors: [PolicyNotFound]` -> `catchTag`-able) survives packing and a
 * real consumer install, not just the source tree. A third proves the
 * `data`-envelope unwrap (protocol.ts's `transformResponse`) the same way.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packForPublish } from '../../../scripts/pack.ts';

const pkgRoot = new URL('../', import.meta.url).pathname;

async function run(cmd: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`distilled-openbao smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-distilled-openbao-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'distilled-openbao-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing…');
  await run(['bun', 'add', tarball], scratch);
  // The peer dependency — bun does not install it automatically.
  await run(['bun', 'add', 'effect@4.0.0-rc.115'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import * as OpenBao from '@homeflare/distilled-openbao';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';

const creds = OpenBao.credentials({
  token: 'smoke-token',
  addr: 'http://127.0.0.1:8299',
  namespace: 'homeflare',
});

// --- 1. a real request, built and captured instead of sent ---
let captured: { method: string; url: string; headers: Record<string, string> } | undefined;
const fakeClient = (status: number, body: unknown) =>
  HttpClient.make((request) => {
    captured = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(Object.entries(request.headers)),
    };
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
      ),
    );
  });

const readPolicy = (status: number, body: unknown) =>
  Effect.runPromiseExit(
    OpenBao.Services.policies.policiesReadAclPolicy({ name: 'agent' }).pipe(
      Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeClient(status, body))),
      Effect.provide(creds),
    ) as Effect.Effect<unknown, unknown, never>,
  );

// A real, decoded 2xx read — proves the {"data": ...} envelope is unwrapped.
const okExit = await readPolicy(200, {
  request_id: 'r-1',
  lease_id: '',
  renewable: false,
  lease_duration: 0,
  data: { name: 'agent', policy: 'path "secret/*" {}', version: 1 },
  wrap_info: null,
  warnings: null,
  auth: null,
});
if (okExit._tag !== 'Success') throw new Error(\`expected success, got \${JSON.stringify(okExit)}\`);
if (captured === undefined) throw new Error('no request was built');
if (captured.method !== 'GET') throw new Error(\`expected GET, got \${captured.method}\`);
if (!captured.url.includes('/v1/sys/policies/acl/agent')) throw new Error(\`unexpected url: \${captured.url}\`);
if (captured.headers['x-vault-token'] !== 'smoke-token') {
  throw new Error(\`expected X-Vault-Token, got: \${JSON.stringify(captured.headers)}\`);
}
if (captured.headers['x-vault-namespace'] !== 'homeflare') {
  throw new Error(\`expected X-Vault-Namespace, got: \${JSON.stringify(captured.headers)}\`);
}
const decoded = okExit.value as Record<string, unknown>;
if (decoded['policy'] !== 'path "secret/*" {}') {
  throw new Error(\`data envelope was not unwrapped: \${JSON.stringify(decoded)}\`);
}
console.log('request + envelope-unwrap ok:', captured.method, captured.url);

// --- 2. the measured absent-policy 404 decodes to the typed tag ---
const notFoundExit = await readPolicy(404, { errors: [] });
if (notFoundExit._tag !== 'Failure') throw new Error('expected a typed failure for the 404');
const failure = (notFoundExit as { cause: unknown }).cause;
const flat = JSON.stringify(failure);
if (!flat.includes('PolicyNotFound')) {
  throw new Error(\`expected PolicyNotFound, got: \${flat}\`);
}
console.log('typed 404 ok: PolicyNotFound');

console.log('\\ndistilled-openbao smoke: ok');
`,
  );

  console.log('importing and building a request…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ndistilled-openbao smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
