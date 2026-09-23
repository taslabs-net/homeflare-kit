/**
 * Consumer smoke test: pack, install, and build a real request for one
 * operation — no live OPNsense call (this package has never been pointed
 * at a real box; see ../README.md), but a real `HttpClientRequest` the
 * SDK's protocol layer produced from the generated operation, credentials
 * and traits, exactly as it would for a genuine call.
 *
 * `quagga_general.get` (`GET /api/quagga/general/get`) is the simplest
 * operation in the package — no path/query parameters, whole-model shape —
 * so this exercises Basic-auth header construction (see ../src/protocol.ts)
 * without also depending on OPNsense's three-shape 200-with-failure decode
 * branches a more typical write operation would exercise.
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
    throw new Error(
      `distilled-opnsense smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`,
    );
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-distilled-opnsense-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'distilled-opnsense-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing…');
  await run(['bun', 'add', tarball], scratch);
  // The peer dependency — bun does not install it automatically.
  await run(['bun', 'add', 'effect@4.0.0-rc.115'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import * as Opnsense from '@homeflare/distilled-opnsense';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';

// Fake HttpClient: captures the outgoing request instead of sending it, and
// answers with a canned 200 (the whole-model {"general": {...}} envelope)
// so the operation's response decoding also runs.
let captured: { method: string; url: string; headers: Record<string, string> } | undefined;
const fakeClient = HttpClient.make((request) => {
  captured = {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(Object.entries(request.headers)),
  };
  return Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify({ general: { enabled: '1', manual_config: '0' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

const program = Opnsense.Services.quagga_general.get({}).pipe(
  Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeClient)),
  Effect.provide(
    Opnsense.credentials({
      apiKey: 'smoke-key',
      apiSecret: 'smoke-secret',
      baseUrl: 'https://opnsense.example.test',
    }),
  ),
);

const result = await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);

if (captured === undefined) throw new Error('no request was built');
if (captured.method !== 'GET') throw new Error(\`expected GET, got \${captured.method}\`);
// Exact match, not .includes(): a doubled "/api/api/..." prefix (the real bug
// this smoke test caught — see ../docs/distilled-interim.md and the distilled
// clone's packages/opnsense/docs/design.md) still CONTAINS this substring one
// segment in, so a looser check would pass on the broken URL too.
const expectedUrl = 'https://opnsense.example.test/api/quagga/general/get';
if (captured.url !== expectedUrl) {
  throw new Error(\`expected \${expectedUrl}, got: \${captured.url}\`);
}
const expectedAuth = \`Basic \${Buffer.from('smoke-key:smoke-secret').toString('base64')}\`;
if (captured.headers['authorization'] !== expectedAuth) {
  throw new Error(\`expected Basic auth scheme, got: \${JSON.stringify(captured.headers)}\`);
}
if ((result as { general?: { enabled?: string } }).general?.enabled !== '1') {
  throw new Error(\`response did not decode: \${JSON.stringify(result)}\`);
}

console.log('request built:', captured.method, captured.url);
console.log('consumer ok');
`,
  );

  console.log('importing and building a request…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ndistilled-opnsense smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
