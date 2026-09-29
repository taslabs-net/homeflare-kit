/**
 * Consumer smoke test: pack the real tarball, install it the way the README says (exact
 * pins plus the root `overrides`), and use it under bun AND node against a fake `fetch`.
 *
 * ★ WHAT ONLY THIS CATCHES (see packages/kit/scripts/smoke.ts for the full history): a
 *   `files` entry that misses `dist`, an `exports` gap, a dev-only dependency imported at
 *   runtime, and — specific to this package — that the compat dependency really resolves
 *   beside the peer at one rc, and that the README's `overrides` really pin
 *   `@effect/platform-node-shared` (an override in a member manifest does nothing;
 *   tests/pairing.test.ts has the measurement).
 * ⛔ NO NETWORK CALL, NO SERVER. The consumer injects `FetchHttpClient.Fetch`, so the CT100
 *   addresses are recorded, never dialled, and the file touches no node globals: the same
 *   text runs under both runtimes and typechecks with no @types/node.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packForPublish } from '../../../scripts/pack.ts';

const pkgRoot = new URL('../', import.meta.url).pathname;

/** The pin, exactly as the README's install line writes it. */
const RC = '4.0.0-rc.115';
const PEER = `effect@${RC}`;
const PLATFORM = `@effect/platform-bun@${RC}`;

async function run(cmd: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`seat-runtime smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const CONSUMER = `import { Effect, Layer } from 'effect';
import * as ConfigProvider from 'effect/ConfigProvider';
import { Chat, EmbeddingModel, LanguageModel, Toolkit } from 'effect/unstable/ai';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { McpToolkitError, SeatModel, SeatObs, VERSION, mcpToolkit, runRounds } from '@homeflare/seat-runtime';

const seen: { url: string; tags: string | null; auth: string | null; body: string }[] = [];
const fake = (async (input: string | URL | Request, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const bytes = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
  seen.push({
    url: String(input),
    tags: headers.get('x-litellm-tags'),
    auth: headers.get('authorization'),
    body: new TextDecoder().decode(bytes),
  });
  const url = String(input);
  if (url.endsWith('/chat/completions')) {
    return Response.json({ id: 'x', object: 'chat.completion', created: 1, model: 'cf-code',
      choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }
  if (url.endsWith('/embeddings')) {
    return Response.json({ object: 'list', model: 'bge', usage: { prompt_tokens: 1, total_tokens: 1 },
      data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }] });
  }
  return new Response(null, { status: 200 });
}) as unknown as typeof fetch;

const layers = Layer.mergeAll(
  SeatModel.layer({ model: 'cf-code', apiUrl: 'http://litellm.test/v1', apiKey: 'smoke-key', tags: ['host:ct100', 'seat:smoke'] }),
  SeatModel.embeddingLayer({ model: 'embeddings', apiUrl: 'http://litellm.test/v1', apiKey: 'smoke-key', tags: 'host:ct100,seat:smoke', dimensions: 3 }),
  SeatObs.layer,
).pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fake)),
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({}))),
);

const program = Effect.gen(function* () {
  const text = (yield* LanguageModel.generateText({ prompt: 'ping' })).text;
  const dims = (yield* EmbeddingModel.EmbeddingModel.use((m) => m.embed('hello'))).vector.length;
  // A log POST exists only when something was logged; the other two signals always flush.
  yield* Effect.log('smoke line');
  // The round loop through the same fake fetch: a model that asks for no tools ends it at once.
  const chat = yield* Chat.fromPrompt('ping');
  const looped = yield* runRounds({ chat, toolkit: yield* Toolkit.empty, maxRounds: 2 });
  return { text, dims, rounds: looped.rounds, capped: looped.capped };
}).pipe(Effect.withSpan('smoke.run'), Effect.provide(layers));

const result = await Effect.runPromise(Effect.scoped(program));
if (result.text !== 'pong' || result.dims !== 3) throw new Error('model calls: ' + JSON.stringify(result));
if (result.rounds !== 1 || result.capped) throw new Error('runRounds: ' + JSON.stringify(result));

// ⚠️ NO SERVER HERE, so mcpToolkit is proved only as far as a refused connection: the SDK's
//   client entry resolved under this runtime's own module rules (a missing \`exports\` subpath or
//   a bare directory import dies at import, not here), and the typed error comes back.
const refused = await Effect.runPromise(
  Effect.scoped(mcpToolkit('http://127.0.0.1:1/mcp?token=smoke-secret')).pipe(Effect.flip),
);
if (!(refused instanceof McpToolkitError) || refused._tag !== 'McpToolkitError' || refused.operation !== 'connect')
  throw new Error('mcpToolkit refused connection: ' + String(refused));
if (refused.message.includes('smoke-secret')) throw new Error('mcpToolkit leaked the query string');

const model = seen.filter((s) => !s.url.includes('opentelemetry'));
if (model.length !== 3) throw new Error('expected 3 model calls, saw ' + model.length);
for (const call of model) {
  if (call.auth !== 'Bearer smoke-key') throw new Error('bearer key: ' + call.auth);
  if (call.tags !== 'host:ct100,seat:smoke') throw new Error('tags: ' + call.tags);
  const body = JSON.parse(call.body) as { num_retries?: number; cache?: unknown };
  if (body.num_retries !== 0 || !body.cache) throw new Error('stamp missing: ' + call.body);
}
const posted = seen.filter((s) => s.url.includes('opentelemetry')).map((s) => s.url).sort();
const want = Object.values(SeatObs.CT100_ENDPOINTS).sort();
if (JSON.stringify(posted) !== JSON.stringify(want)) throw new Error('OTLP posts: ' + posted.join(' '));
console.log('consumer ok', VERSION, posted.length, 'OTLP posts');
`;

const scratch = await mkdtemp(join(tmpdir(), 'hf-seat-runtime-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  // ⚠️ The consumer's ROOT manifest, as the README writes it. `overrides` works only here.
  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify(
      {
        name: 'seat-runtime-smoke',
        private: true,
        type: 'module',
        overrides: { effect: RC, '@effect/platform-node-shared': RC },
      },
      null,
      2,
    ),
  );

  console.log('installing as a consumer would (with platform-bun, the trap)…');
  await run(['bun', 'add', tarball, PEER, PLATFORM], scratch);

  const version = async (name: string): Promise<string> =>
    (
      (await Bun.file(join(scratch, 'node_modules', name, 'package.json')).json()) as {
        version: string;
      }
    ).version;
  const installed = {
    effect: await version('effect'),
    compat: await version('@effect/ai-openai-compat'),
    shared: await version('@effect/platform-node-shared'),
  };
  console.log('installed:', JSON.stringify(installed));
  for (const [name, found] of Object.entries(installed)) {
    // ⛔ All three at the one rc, or the consumer crashes at import (see tests/pairing.test.ts).
    if (found !== RC) throw new Error(`seat-runtime smoke: ${name} resolved ${found}, want ${RC}`);
  }

  // The MCP SDK is this package's OWN pinned dependency (not the rc), so it must arrive at the
  // version the manifest names: a consumer cannot choose a different one.
  const manifest = (await Bun.file(join(pkgRoot, 'package.json')).json()) as {
    dependencies: Record<string, string>;
  };
  const mcp = await version('@modelcontextprotocol/sdk');
  if (mcp !== manifest.dependencies['@modelcontextprotocol/sdk'])
    throw new Error(`seat-runtime smoke: @modelcontextprotocol/sdk resolved ${mcp}`);

  await Bun.write(join(scratch, 'consumer.ts'), CONSUMER);

  console.log('running under bun…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  // ⛔ NODE IS DELIBERATE: bun's resolver forgives things node's does not.
  console.log('running under node…');
  console.log(await run(['node', '--experimental-strip-types', 'consumer.ts'], scratch));

  await Bun.write(
    join(scratch, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'esnext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    ),
  );
  console.log('typechecking as a nodenext consumer…');
  await run(['bun', 'add', '-d', 'typescript@7.0.2'], scratch);
  const tsc = Bun.spawn(['bunx', 'tsc', '--noEmit'], {
    cwd: scratch,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(tsc.stdout).text();
  await tsc.exited;
  // ⚠️ skipLibCheck is OFF so a .d.ts naming a file the tarball lacks fails here. But
  //   compat's OWN .d.ts has 26 TS2411 errors under it (measured 2026-09-29 by the scout,
  //   tsc 7.0.2). Those are upstream's, so they are allowed; an error anywhere else is ours.
  const foreign = output
    .split('\n')
    .filter((line) => /error TS/.test(line) && !line.includes('@effect/ai-openai-compat'));
  if (foreign.length > 0)
    throw new Error(`seat-runtime smoke: consumer typecheck\n${foreign.join('\n')}`);
  console.log(
    `typecheck ok (${output.split('\n').filter((l) => l.includes('error TS')).length} upstream errors in compat)`,
  );

  console.log('\nseat-runtime smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
