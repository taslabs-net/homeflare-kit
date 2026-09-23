/**
 * Consumer smoke test: pack, install, and build a real request for one
 * operation — no live PBS call (no PBS host or credential exists in the
 * estate yet), but a real `HttpClientRequest` the SDK's protocol layer
 * produced from the generated operation, credentials and traits, exactly
 * as it would for a genuine call.
 *
 * `getVersion` (`GET /version`) is the simplest operation in the package —
 * no path/query parameters at all — so this exercises credential-header
 * construction and the `{"data": ...}` envelope unwrap (see
 * ../src/protocol.ts) without also depending on a path-label encoding
 * path a more typical PBS operation (`{node}`, `{store}`, …) would need.
 * Ported from packages/distilled-proxmox's identical smoke test — the one
 * assertion that had to change is the auth header: `PBSAPIToken=<id>:
 * <secret>`, a colon, not PVE's `PVEAPIToken=<id>=<secret>`.
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
      `distilled-proxmox-backup smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`,
    );
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-distilled-proxmox-backup-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify(
      { name: 'distilled-proxmox-backup-smoke', private: true, type: 'module' },
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
    `import * as ProxmoxBackup from '@homeflare/distilled-proxmox-backup';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';

// Fake HttpClient: captures the outgoing request instead of sending it, and
// answers with a canned 200 (PBS's own {"data": ...} envelope) so the
// operation's response decoding also runs.
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
        JSON.stringify({ data: { version: '4.2.6', release: '4.2', repoid: 'abc123def' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
});

const program = ProxmoxBackup.Services.version.getVersion({}).pipe(
  Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeClient)),
  Effect.provide(
    ProxmoxBackup.credentials({
      tokenId: 'backup@pbs!smoke',
      secret: 'smoke-secret',
      baseUrl: 'https://pbs.example.test:8007',
    }),
  ),
);

const result = await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);

if (captured === undefined) throw new Error('no request was built');
if (captured.method !== 'GET') throw new Error(\`expected GET, got \${captured.method}\`);
if (!captured.url.includes('/api2/json/version')) throw new Error(\`unexpected url: \${captured.url}\`);
if (captured.headers['authorization'] !== 'PBSAPIToken=backup@pbs!smoke:smoke-secret') {
  throw new Error(\`expected PBSAPIToken auth scheme (colon separator), got: \${JSON.stringify(captured.headers)}\`);
}
if ((result as Record<string, unknown>)['version'] !== '4.2.6') {
  throw new Error(\`response envelope was not unwrapped: \${JSON.stringify(result)}\`);
}

console.log('request built:', captured.method, captured.url);
console.log('consumer ok');
`,
  );

  console.log('importing and building a request…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ndistilled-proxmox-backup smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
