/**
 * Consumer smoke test: pack the real tarball, install it, and use it.
 *
 * 🔴 WHY THIS REPLACES AN `echo`. The old script was
 *   `echo 'cloudflare: smoke covered by @homeflare/kit'` — a claim, not a check, and it
 *   was false: this package has its own entrypoint, its own dependency on `jose`, and a
 *   `workspace:*` dependency on @homeflare/kit that only resolves correctly when packed.
 * ⛔ THE SAME PATTERN SHIPPED THREE DEFECTS IN @homeflare/alchemy on 2026-09-16, each of
 *   which installed cleanly and threw at IMPORT. A pack-only check passes all three.
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
    throw new Error(`cloudflare smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-cf-smoke-'));

try {
  console.log('packing…');
  // ⚠️ @homeflare/kit is a workspace dependency here, so the tarball must carry a real
  //   version rather than `workspace:*` — pack it too and install both.
  const cfTarball = await packForPublish(pkgRoot, scratch);
  const kitTarball = await packForPublish(join(pkgRoot, '../kit'), scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'cf-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing…');
  await run(['bun', 'add', cfTarball, kitTarball], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import {
  verifyAccessJwt, accessIdentity, hasAccess,
  serveMcpMetadata, unauthorizedResponse, wellKnownPath,
  log, breakered, BREAKER_COOLDOWN_MS, VERSION,
} from '@homeflare/cloudflare';

if (typeof verifyAccessJwt !== 'function') throw new Error('verifyAccessJwt missing');
if (typeof breakered !== 'function') throw new Error('breakered missing');
if (typeof BREAKER_COOLDOWN_MS !== 'number') throw new Error('BREAKER_COOLDOWN_MS missing');
if (typeof VERSION !== 'string') throw new Error('VERSION missing');

// ⛔ The logger writes ONE JSON object per line — Workers Logs indexes it field by field.
//   Calling it proves the module loads and the shape survives the build.
log.with({ requestId: 'smoke' }).info('hello', { ok: true });

// ⛔ The breaker latches a failing URL. This is the amplification guard, so exercise it
//   rather than trusting that it exported.
let calls = 0;
const fetcher = breakered(async () => {
  calls += 1;
  return new Response('down', { status: 404 });
});
const opts = { headers: new Headers(), method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000) };
for (let i = 0; i < 3; i += 1) await fetcher('https://team.invalid/certs', opts).catch(() => undefined);
if (calls !== 1) throw new Error('breaker did not latch: ' + calls + ' fetches');

// ⛔ The ctx.access path must work with no token anywhere near it — that is the whole
//   reason it exists, and an app team's suite fails if jose appears in this layer.
const who = await accessIdentity({ access: { getIdentity: async () => ({ email: 'a@b.c', groups: ['eng'] }) } });
if (who?.email !== 'a@b.c') throw new Error('accessIdentity did not read identity');
if (who.groups[0] !== 'eng') throw new Error('groups missing');
if (await accessIdentity({}) !== undefined) throw new Error('should be undefined without ctx.access');
if (hasAccess({}) !== false) throw new Error('hasAccess wrong');

// ⛔ RFC 9728: the 401 must NAME the metadata document, or discovery dead-ends.
const mcp = { resource: 'https://mcp.example.com/mcp', authorizationServer: 'https://t.cloudflareaccess.com' };
if (wellKnownPath(mcp.resource) !== '/.well-known/oauth-protected-resource/mcp') throw new Error('well-known path wrong');
const served = serveMcpMetadata(new Request('https://mcp.example.com/.well-known/oauth-protected-resource/mcp'), mcp);
if (served === undefined) throw new Error('metadata not served');
const header = unauthorizedResponse(mcp).headers.get('www-authenticate') ?? '';
if (!header.includes('resource_metadata=')) throw new Error('401 does not point at metadata');

console.log('consumer ok', VERSION);
`,
  );

  console.log('importing and exercising…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ncloudflare smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
