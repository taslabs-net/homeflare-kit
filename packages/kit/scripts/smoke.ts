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
  const packed = (await run(['npm', 'pack', '--pack-destination', scratch], pkgRoot)).trim();
  const tarball = join(scratch, packed.split('\n').at(-1) ?? '');

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
  await run(['npm', 'install', '--no-audit', '--no-fund', tarball], scratch);

  console.log('running under bun…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

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
  await run(['npm', 'install', '--no-audit', '--no-fund', '-D', 'typescript@7.0.2'], scratch);
  await run(['npx', 'tsc', '--noEmit'], scratch);

  console.log('\nsmoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
