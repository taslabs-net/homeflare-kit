/**
 * Consumer smoke test: pack, install, and build a real request for one
 * operation — no live NetBox call (network would need a real instance and
 * would write nothing useful), but a real `HttpClientRequest` the SDK's
 * protocol layer produced from the generated operation, credentials and
 * traits, exactly as it would for a genuine call.
 *
 * `getStatus` (`GET /api/status/`) is deliberately the operation this whole
 * package's provenance rests on: it is the endpoint measured read-only on
 * CT100 to pin the NetBox version (`v4.7.0`) the SDK was generated against
 * — see ../README.md and ../../alchemy/docs/distilled-interim.md.
 *
 * A second check runs `listCoreDataSources.pages()` against a two-page fake
 * response (`next` a full URL on page 1, `null` on page 2) and asserts the
 * SECOND request's URL carries the `offset` parsed out of page 1's `next`,
 * AND that a multi-valued array filter (`id=1&id=2`, echoed back by `next`
 * as repeated same-key pairs — how core's own request builder serializes an
 * array-typed query member) survives onto that second request intact rather
 * than collapsing to its last value. This is the packed-tarball equivalent
 * of `netboxPaginate`'s own unit coverage in the distilled clone, proving
 * the wiring (patches → generated `pagination: {...}` block →
 * `netboxPaginate` import) survives packing and a real consumer install,
 * not just the source tree.
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
    throw new Error(`distilled-netbox smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-distilled-netbox-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'distilled-netbox-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing…');
  await run(['bun', 'add', tarball], scratch);
  // The peer dependency — bun does not install it automatically.
  await run(['bun', 'add', 'effect@4.0.0-rc.115'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import * as Netbox from '@homeflare/distilled-netbox';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Stream from 'effect/Stream';
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
      new Response(JSON.stringify({ 'netbox-version': '4.7.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

const program = Netbox.Services.status.getStatus({}).pipe(
  Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeClient)),
  Effect.provide(Netbox.credentials({ token: 'smoke-token', baseUrl: 'https://netbox.example.com' })),
);

const result = await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);

if (captured === undefined) throw new Error('no request was built');
if (captured.method !== 'GET') throw new Error(\`expected GET, got \${captured.method}\`);
if (!captured.url.includes('/api/status/')) throw new Error(\`unexpected url: \${captured.url}\`);
if (captured.headers['authorization'] !== 'Token smoke-token') {
  throw new Error(\`expected Token auth scheme, got: \${JSON.stringify(captured.headers)}\`);
}
if ((result as Record<string, unknown>)['netbox-version'] !== '4.7.0') {
  throw new Error(\`response did not decode: \${JSON.stringify(result)}\`);
}

console.log('request built:', captured.method, captured.url);
console.log('consumer ok');

// --- pagination: follow a URL-valued \`next\` across two pages ---
// A minimal-but-valid DataSource (every required member of the generated
// schema filled; \`type\`/\`status\` members are themselves all-optional).
const dataSource = (id: number) => ({
  id,
  url: \`https://netbox.example.com/api/core/data-sources/\${id}/\`,
  display_url: \`https://netbox.example.com/core/data-sources/\${id}/\`,
  display: \`ds-\${id}\`,
  name: \`ds-\${id}\`,
  type: {},
  source_url: 'https://example.com/repo.git',
  status: {},
  created: null,
  last_updated: null,
  last_synced: null,
  file_count: 0,
});
const pageUrls: string[] = [];
let call = 0;
const pagingClient = HttpClient.make((request) => {
  pageUrls.push(request.url);
  call += 1;
  // Page 1's \`next\` echoes an \`id\` filter TWICE (\`id=1&id=2\`, the same
  // repeated-key shape core's request builder just used to send it) — this
  // is what a real multi-select NetBox filter looks like on the wire, and
  // is the case netboxPaginate must not collapse to a single surviving id.
  const body =
    call === 1
      ? {
          count: 2,
          next: 'https://netbox.example.com/api/core/data-sources/?id=1&id=2&limit=1&offset=1',
          previous: null,
          results: [dataSource(1)],
        }
      : { count: 2, next: null, previous: 'https://netbox.example.com/api/core/data-sources/?id=1&id=2&limit=1&offset=0', results: [dataSource(2)] };
  return Effect.succeed(
    HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
});

const itemsStream = (Netbox.Services.core.listCoreDataSources as any).items({
  limit: 1,
  id: [1, 2],
}) as Stream.Stream<unknown, unknown, unknown>;
const items = await Effect.runPromise(
  Stream.runCollect(itemsStream).pipe(
    Effect.map((c) => Array.from(c as Iterable<unknown>)),
    Effect.provide(Layer.succeed(HttpClient.HttpClient, pagingClient)),
    Effect.provide(Netbox.credentials({ token: 'smoke-token', baseUrl: 'https://netbox.example.com' })),
  ) as Effect.Effect<unknown[], unknown, never>,
);

if (call !== 2) throw new Error(\`expected 2 requests, got \${call}\`);
if (!pageUrls[1]?.includes('offset=1')) throw new Error(\`2nd request did not carry the parsed offset: \${pageUrls[1]}\`);
const secondIdCount = (pageUrls[1]?.match(/(?:^|[?&])id=/g) ?? []).length;
if (secondIdCount !== 2) {
  throw new Error(\`2nd request lost the multi-valued id filter (expected id=1&id=2, got \${secondIdCount} id= occurrences): \${pageUrls[1]}\`);
}
if (items.length !== 2) throw new Error(\`expected 2 items across both pages, got \${JSON.stringify(items)}\`);

console.log('pagination ok:', pageUrls.join(' -> '));
`,
  );

  console.log('importing and building a request…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ndistilled-netbox smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
