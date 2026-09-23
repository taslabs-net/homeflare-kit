/**
 * Consumer smoke test: pack, install, and build a real request for one
 * operation — no live UniFi console call (that needs a real console and a
 * key this package must never carry), but a real `HttpClientRequest` the
 * SDK's protocol layer produced from the generated operation, credentials
 * and traits, exactly as it would for a genuine call.
 *
 * `getSiteOverviewPage` (`GET /v1/sites`) is the operation this package's
 * whole family starts from — see ../README.md and
 * ../../alchemy/docs/distilled-interim.md — and the one every future
 * UniFi Resource needs first (a site id is required for every other call).
 * This asserts the `X-API-KEY` header this SDK sends actually reaches the
 * request, since that header is NOT documented in the vendor's own spec
 * (see ../README.md's "Authentication is NOT documented in the spec").
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
      `distilled-unifi-network smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`,
    );
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-distilled-unifi-network-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify(
      { name: 'distilled-unifi-network-smoke', private: true, type: 'module' },
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
    `import * as UnifiNetwork from '@homeflare/distilled-unifi-network';
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
      new Response(
        JSON.stringify({ count: 0, data: [], limit: 25, offset: 0, totalCount: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
});

const program = UnifiNetwork.Services.sites.getSiteOverviewPage({}).pipe(
  Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeClient)),
  Effect.provide(
    UnifiNetwork.credentials({
      apiKey: 'smoke-key',
      apiBaseUrl: 'https://console.example.com/proxy/network/integration',
    }),
  ),
);

const result = await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);

if (captured === undefined) throw new Error('no request was built');
if (captured.method !== 'GET') throw new Error(\`expected GET, got \${captured.method}\`);
if (!captured.url.includes('/v1/sites')) throw new Error(\`unexpected url: \${captured.url}\`);
if (captured.headers['x-api-key'] !== 'smoke-key') {
  throw new Error(\`expected X-API-KEY header, got: \${JSON.stringify(captured.headers)}\`);
}
if ((result as Record<string, unknown>)['totalCount'] !== 0) {
  throw new Error(\`response did not decode: \${JSON.stringify(result)}\`);
}

console.log('request built:', captured.method, captured.url);
console.log('consumer ok');
`,
  );

  console.log('importing and building a request…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ndistilled-unifi-network smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
