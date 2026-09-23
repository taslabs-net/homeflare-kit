/**
 * Consumer smoke test: pack, install, and build a real request for one
 * operation — no live Caddy call (the admin API has no auth and this must
 * never touch a real one), but a real `HttpClientRequest` the SDK's
 * protocol layer produced from the generated operation, credentials and
 * traits, exactly as it would for a genuine call.
 *
 * `caInfo` (`GET /pki/ca/{id}`) is deliberately a STANDARD-decode
 * operation — unlike `getConfig` (bare document + Etag header) or
 * `loadConfig` (200-with-embedded-error), both hand-special-cased in
 * `../src/protocol.ts` — so this smoke test exercises the generic 2xx-is-
 * payload path everything else in this package also uses.
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
    throw new Error(`distilled-caddy smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-distilled-caddy-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'distilled-caddy-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing…');
  await run(['bun', 'add', tarball], scratch);
  // The peer dependency — bun does not install it automatically.
  await run(['bun', 'add', 'effect@4.0.0-rc.115'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import * as Caddy from '@homeflare/distilled-caddy';
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
        JSON.stringify({
          id: 'local',
          name: 'Caddy Local Authority',
          root_common_name: 'Caddy Local Authority - 2026 ECC Root',
          intermediate_common_name: 'Caddy Local Authority - ECC Intermediate',
          root_certificate: '-----BEGIN CERTIFICATE-----\\nsmoke\\n-----END CERTIFICATE-----',
          intermediate_certificate: '-----BEGIN CERTIFICATE-----\\nsmoke\\n-----END CERTIFICATE-----',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
});

const program = Caddy.Services.admin.caInfo({ id: 'local' }).pipe(
  Effect.provide(Caddy.CaddyProtocol),
  Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeClient)),
  Effect.provide(Caddy.fromApiBaseUrl({})),
);

const result = await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);

if (captured === undefined) throw new Error('no request was built');
if (captured.method !== 'GET') throw new Error(\`expected GET, got \${captured.method}\`);
if (!captured.url.includes('/pki/ca/local')) throw new Error(\`unexpected url: \${captured.url}\`);
if (captured.headers['host'] !== '127.0.0.1:2019') {
  throw new Error(\`expected Caddy's own DNS-rebinding Host check to be satisfied, got: \${JSON.stringify(captured.headers)}\`);
}
if ((result as Record<string, unknown>)['root_common_name'] !== 'Caddy Local Authority - 2026 ECC Root') {
  throw new Error(\`response did not decode: \${JSON.stringify(result)}\`);
}

console.log('request built:', captured.method, captured.url);
console.log('consumer ok');
`,
  );

  console.log('importing and building a request…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ndistilled-caddy smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
