/**
 * Consumer smoke test: pack, install, and build a real request for one
 * operation — no live LiteLLM Proxy call (network would need a running
 * instance and this task's own instructions forbid live LiteLLM calls
 * anyway), but a real `HttpClientRequest` the SDK's protocol layer produced
 * from the generated operation, credentials and traits, exactly as it
 * would for a genuine call.
 *
 * `listKeysKeyListGet` (`GET /key/list`) is deliberately the operation this
 * smoke test exercises: it is one of the primary key_management routes this
 * package's own error patches (`../patches/key_management/*.json`) and the
 * `GenerateKeyResponse.key` redaction were verified against — see
 * ../../../../upstream/distilled/packages/litellm/docs/errors.md (in the
 * distilled clone this package's `src/` was copied from) and
 * ../../alchemy/docs/distilled-interim.md.
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
    throw new Error(`distilled-litellm smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-distilled-litellm-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'distilled-litellm-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing…');
  await run(['bun', 'add', tarball], scratch);
  // The peer dependency — bun does not install it automatically.
  await run(['bun', 'add', 'effect@4.0.0-rc.115'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import * as Litellm from '@homeflare/distilled-litellm';
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
      new Response(JSON.stringify({ total_count: 3, current_page: 1, total_pages: 1, keys: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

const program = Litellm.Services.keyManagement.listKeysKeyListGet({}).pipe(
  Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeClient)),
  Effect.provide(
    Litellm.credentials({ apiKey: 'smoke-key', baseUrl: 'https://litellm.example.com' }),
  ),
);

const result = await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);

if (captured === undefined) throw new Error('no request was built');
if (captured.method !== 'GET') throw new Error(\`expected GET, got \${captured.method}\`);
if (!captured.url.includes('/key/list')) throw new Error(\`unexpected url: \${captured.url}\`);
if (captured.headers['authorization'] !== 'Bearer smoke-key') {
  throw new Error(\`expected Bearer auth scheme, got: \${JSON.stringify(captured.headers)}\`);
}
if ((result as Record<string, unknown>)['total_count'] !== 3) {
  throw new Error(\`response did not decode: \${JSON.stringify(result)}\`);
}

console.log('request built:', captured.method, captured.url);
console.log('consumer ok');
`,
  );

  console.log('importing and building a request…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ndistilled-litellm smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
