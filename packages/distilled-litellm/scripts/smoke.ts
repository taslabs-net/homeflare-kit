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
 *
 * It then sends the two data-plane routes whose request bodies are typed by
 * patch (`POST /v2/rerank`, `POST /mcp-rest/tools/call` — the vendor spec
 * declares no body for them, see the distilled clone's
 * `packages/litellm/docs/data-plane-bodies.md`) and asserts the typed fields
 * reach the wire as the JSON body the proxy handler reads.
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
  await run(['bun', 'add', 'effect@4.0.1'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import * as Litellm from '@homeflare/distilled-litellm';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';

// Fake HttpClient: captures the outgoing request instead of sending it, and
// answers with a canned 200 so the operation's response decoding also runs.
let captured:
  | { method: string; url: string; headers: Record<string, string>; body: unknown }
  | undefined;
const fakeClient = HttpClient.make((request) => {
  const body = request.body as { _tag: string; body?: Uint8Array };
  captured = {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(Object.entries(request.headers)),
    // A JSON body arrives as a Uint8Array HttpBody; anything else means no body was sent.
    body: body._tag === 'Uint8Array' ? JSON.parse(new TextDecoder().decode(body.body)) : undefined,
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

const provide = (effect: Effect.Effect<unknown, unknown, unknown>) =>
  effect.pipe(
    Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeClient)),
    Effect.provide(
      Litellm.credentials({ apiKey: 'smoke-key', baseUrl: 'https://litellm.example.com' }),
    ),
  ) as Effect.Effect<unknown, unknown, never>;

const result = await Effect.runPromise(provide(Litellm.Services.keyManagement.listKeysKeyListGet({})));

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

// Typed data-plane bodies: the proxy handlers read the raw JSON body, so the
// fields must arrive at the top level exactly as the caller gave them.
const rerankBody = { model: 'rerank-v1', query: 'q', documents: ['a', { text: 'b' }], top_n: 1 };
await Effect.runPromise(provide(Litellm.Services.rerank.postRerankV2Rerank(rerankBody)));
if (captured.method !== 'POST' || !captured.url.endsWith('/v2/rerank')) {
  throw new Error(\`unexpected rerank request: \${captured.method} \${captured.url}\`);
}
// The body is encoded in schema order, not call order, so compare structurally.
if (!Bun.deepEquals(captured.body, rerankBody)) {
  throw new Error(\`rerank body did not reach the wire: \${JSON.stringify(captured.body)}\`);
}

const toolBody = { server_id: 'srv', name: 'tool', arguments: { a: 1 } };
await Effect.runPromise(
  provide(Litellm.Services.mcpRest.postCallToolRestApiMcpRestToolsCall(toolBody)),
);
if (captured.method !== 'POST' || !captured.url.endsWith('/mcp-rest/tools/call')) {
  throw new Error(\`unexpected tool-call request: \${captured.method} \${captured.url}\`);
}
if (!Bun.deepEquals(captured.body, toolBody)) {
  throw new Error(\`tool-call body did not reach the wire: \${JSON.stringify(captured.body)}\`);
}

console.log('typed bodies ok: rerank, mcp tools/call');
console.log('consumer ok');
`,
  );

  console.log('importing and building a request…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ndistilled-litellm smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
