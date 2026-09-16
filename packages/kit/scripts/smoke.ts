/**
 * Consumer smoke test: pack the real tarball, install it into a scratch project, and
 * use it the way an app would.
 *
 * ★ WHY THIS EXISTS ON TOP OF tests/dist.test.ts. That test imports dist/ by path, from
 *   inside this repo, under bun. It cannot see anything that only breaks once npm is the
 *   one resolving: a missing `files` entry, an `exports` map that omits a subpath, a
 *   dependency that is dev-only but imported at runtime. Those failures land in the
 *   CONSUMING repo, days later, and read as that repo's bug.
 *
 * ⚠️ Node is checked as well as bun, deliberately. Bun's resolver is forgiving in ways
 *   workerd and Node are not, so a bun-only pass is not evidence a consumer can use
 *   this. `--experimental-strip-types` runs the TS consumer file directly on Node 22+.
 *
 * ⛔ Uses `npm pack`, not a file: link. A link resolves through the working tree and
 *   would hide exactly the packaging mistakes this is for.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packForPublish } from '../../../scripts/pack.ts';

// ⚠️ '../' from scripts/ is the PACKAGE root, not the repo root. npm pack must run in
//   the package directory: at the repo root it would pack the private workspace root,
//   which publishes nothing and fails in a way that names neither package.
const pkgRoot = new URL('../', import.meta.url).pathname;

async function run(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    // ⚠️ Name the command AND the exit code. A bare stack trace from this line says
    //   only "smoke.ts:31", which is true of every step — packing, two installs, two
    //   runtimes and a typecheck — and the npm steps reach the network, so a failure
    //   here is sometimes transient rather than a real packaging fault.
    throw new Error(`smoke: \`${cmd.join(' ')}\` exited ${code} in ${cwd}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-kit-smoke-'));

try {
  console.log('packing…');
  // ★ The SHARED pack path, same as the release — so the tarball this gate inspects is
  //   the tarball a consumer receives. `bun pm pack` also resolves `catalog:` and
  //   `workspace:` specifiers, which `npm pack` leaves literal.
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'smoke', private: true, type: 'module' }, null, 2),
  );

  // The consumer exercises the public surface the way an app would: a Worker-shaped env
  // object in, typed config out.
  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import { parseEnv, EnvError, VERSION } from '@homeflare/kit';

const cfg = parseEnv(
  { API_URL: { type: 'string' }, PORT: { type: 'number', default: 8787 }, DEBUG: { type: 'boolean' } },
  { API_URL: 'https://example.invalid', DEBUG: 'false' },
);

if (cfg.PORT !== 8787) throw new Error('default not applied');
if (cfg.DEBUG !== false) throw new Error("'false' did not parse as false");
if (typeof VERSION !== 'string') throw new Error('VERSION missing');

let threw = false;
try {
  parseEnv({ TOKEN: { type: 'string' } }, {});
} catch (e) {
  threw = e instanceof EnvError;
}
if (!threw) throw new Error('EnvError not thrown or not instanceof across the boundary');

console.log('consumer ok', VERSION, cfg.API_URL);
`,
  );

  console.log('installing tarball…');
  await run(['bun', 'add', tarball], scratch);

  console.log('running under bun…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  // ⛔ THE OPENAPI SUBPATH IS OPTIONAL. A consumer of parseEnv must not need hono.
  //   Installing the peers here, after the main import, proves the subpath resolves
  //   when opted into — without making the runtime-neutral smoke depend on them.
  console.log('installing OpenAPI peers…');
  await run(['bun', 'add', 'hono@4.13.7', '@hono/zod-openapi@1.6.3', 'zod@4.6.5'], scratch);
  await Bun.write(
    join(scratch, 'consumer-openapi.ts'),
    `import { createOpenApiApp } from '@homeflare/kit/openapi';
const app = createOpenApiApp();
if (typeof app.fetch !== 'function') throw new Error('createOpenApiApp did not return OpenAPIHono');
console.log('openapi ok');
`,
  );
  console.log(await run(['bun', 'consumer-openapi.ts'], scratch));

  // ⛔ NODE HERE IS DELIBERATE AND MUST STAY. Everything else in this repo is bun-native,
  //   but @homeflare/kit promises to be RUNTIME-NEUTRAL — consumers run it on workerd and
  //   on node, not on bun. Testing only under bun would test the one runtime no consumer
  //   uses, and bun's resolver is forgiving in ways node's is not.
  console.log('running under node…');
  console.log(await run(['node', '--experimental-strip-types', 'consumer.ts'], scratch));

  // ⚠️ Types are checked from the CONSUMER's side with skipLibCheck OFF. A .d.ts that
  //   references a file the tarball does not ship passes in this repo and fails here.
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
      },
      null,
      2,
    ),
  );

  console.log('typechecking as a nodenext consumer…');
  await run(['bun', 'add', '-d', 'typescript@7.0.2'], scratch);
  await run(['npx', 'tsc', '--noEmit'], scratch);

  console.log('\nsmoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
