/**
 * Consumer smoke test: pack, install, and build a real request for one
 * operation — no live Paperless-ngx call (network would need a real
 * instance and would write nothing useful), but a real `HttpClientRequest`
 * the SDK's protocol layer produced from the generated operation,
 * credentials and traits, exactly as it would for a genuine call.
 *
 * `getStatus` (`GET /api/status/`) is deliberately the operation this whole
 * package's provenance rests on: it is the endpoint
 * codegen/manifest.json's `paperless-openapi` entry names as the one read,
 * with no credential, to confirm the pinned document is actually served by
 * a running instance — see ../README.md and
 * ../../alchemy/docs/distilled-interim.md. It is also the exact operation
 * NetBox's sibling smoke test uses, for the same reason (a single-endpoint
 * tag with no id-path complications).
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
      `distilled-paperless-ngx smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`,
    );
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-distilled-paperless-ngx-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify(
      { name: 'distilled-paperless-ngx-smoke', private: true, type: 'module' },
      null,
      2,
    ),
  );

  console.log('installing…');
  await run(['bun', 'add', tarball], scratch);
  // The peer dependency — bun does not install it automatically.
  await run(['bun', 'add', 'effect@4.0.0-rc.115'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import * as PaperlessNgx from '@homeflare/distilled-paperless-ngx';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';

// Fake HttpClient: captures the outgoing request instead of sending it, and
// answers with a canned 200 so the operation's response decoding also runs.
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
      new Response(JSON.stringify({ pngx_version: '3.1.1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

const program = PaperlessNgx.Services.status.getStatus({}).pipe(
  Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeClient)),
  Effect.provide(
    PaperlessNgx.credentials({ token: 'smoke-token', baseUrl: 'https://paperless.example.com' }),
  ),
);

const result = await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);

if (captured === undefined) throw new Error('no request was built');
if (captured.method !== 'GET') throw new Error(\`expected GET, got \${captured.method}\`);
if (!captured.url.includes('/api/status/')) throw new Error(\`unexpected url: \${captured.url}\`);
if (captured.headers['authorization'] !== 'Token smoke-token') {
  throw new Error(\`expected Token auth scheme, got: \${JSON.stringify(captured.headers)}\`);
}
if (captured.headers['accept'] !== 'application/json; version=10') {
  throw new Error(\`expected the pinned API version header, got: \${JSON.stringify(captured.headers)}\`);
}
if ((result as Record<string, unknown>)['pngx_version'] !== '3.1.1') {
  throw new Error(\`response did not decode: \${JSON.stringify(result)}\`);
}

console.log('request built:', captured.method, captured.url);
console.log('consumer ok');
`,
  );

  console.log('importing and building a request…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ndistilled-paperless-ngx smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
