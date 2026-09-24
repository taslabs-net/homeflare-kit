/**
 * Consumer smoke test: pack, install, and build a real request for one
 * operation — no live Grafana call (network would need a real instance and
 * would write nothing useful), but a real `HttpClientRequest` the SDK's
 * protocol layer produced from the generated operation, credentials and
 * traits, exactly as it would for a genuine call.
 *
 * `getFolderByUID` (`GET /folders/{folder_uid}`) is deliberately the
 * operation this smoke test exercises: it is one of the 32 operations this
 * package's introducing PR added by patching Grafana's spec's
 * `deprecated: true` flag back off (see ../README.md and
 * ../../alchemy/docs/grafana.md) — this proves the fix survives packing and
 * a real consumer install, not just the source tree and the distilled
 * clone's own typecheck.
 *
 * A second check calls `postDashboard` against a canned 412 response and
 * asserts it decodes to the `PreconditionFailed` error class this PR added
 * to `statusToErrorClass` — the dashboard `version`-conflict case
 * docs/grafana.md's Credentials section and the task that produced this PR
 * both call out as needing to be `catchTag`-able.
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
    throw new Error(`distilled-grafana smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-distilled-grafana-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'distilled-grafana-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing…');
  await run(['bun', 'add', tarball], scratch);
  // The peer dependency — bun does not install it automatically.
  await run(['bun', 'add', 'effect@4.0.0-rc.115'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import * as Grafana from '@homeflare/distilled-grafana';
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
      new Response(JSON.stringify({ uid: 'my-folder', title: 'My Folder' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

const credentials = Grafana.fromApiKey({ apiKey: 'smoke-token', apiBaseUrl: 'https://grafana.example.com' });

const program = Grafana.Services.grafana.getFolderByUID({ folder_uid: 'my-folder' }).pipe(
  Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeClient)),
  Effect.provide(credentials),
);

const result = await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);

if (captured === undefined) throw new Error('no request was built');
if (captured.method !== 'GET') throw new Error(\`expected GET, got \${captured.method}\`);
if (!captured.url.includes('/api/folders/my-folder')) throw new Error(\`unexpected url: \${captured.url}\`);
if (captured.headers['authorization'] !== 'Bearer smoke-token') {
  throw new Error(\`expected Bearer auth scheme, got: \${JSON.stringify(captured.headers)}\`);
}
if ((result as Record<string, unknown>)['uid'] !== 'my-folder') {
  throw new Error(\`response did not decode: \${JSON.stringify(result)}\`);
}

console.log('request built:', captured.method, captured.url);
console.log('getFolderByUID ok');

// --- PreconditionFailed: the 412 dashboard.version-conflict case ---
const conflictClient = HttpClient.make((request) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify({ message: 'The dashboard has been changed by someone else' }), {
        status: 412,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  ),
);

let caughtTag: string | undefined;
const conflictProgram = Grafana.Services.grafana
  .postDashboard({ dashboard: {}, overwrite: false })
  .pipe(
    Effect.catchTag('PreconditionFailed', (e) => {
      caughtTag = e._tag;
      return Effect.void;
    }),
    Effect.provide(Layer.succeed(HttpClient.HttpClient, conflictClient)),
    Effect.provide(credentials),
  );

await Effect.runPromise(conflictProgram as Effect.Effect<void, never, never>);
if (caughtTag !== 'PreconditionFailed') {
  throw new Error(\`expected catchTag('PreconditionFailed', …) to run, got: \${String(caughtTag)}\`);
}

console.log('postDashboard 412 -> PreconditionFailed ok');
console.log('\\ndistilled-grafana smoke: ok');
`,
  );

  console.log('importing and building a request…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ndistilled-grafana smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
