/**
 * Consumer smoke test: pack, install, and USE every published export.
 *
 * 🔴 WHY THIS REPLACES AN `echo`. The old script pointed at an in-repo test, which cannot
 *   see what a CONSUMER sees: this package ships five JSON/TOML files behind an export
 *   map, and a map that points at a missing file passes every in-repo check.
 * ⛔ `tsconfig.base.json` is the highest-stakes one — a project `extends` it, so a broken
 *   path breaks that project's typecheck rather than this package's.
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
    throw new Error(`config smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-config-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'config-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing…');
  await run(['bun', 'add', tarball, 'typescript@7.0.2'], scratch);

  // ⛔ EXTEND IT FOR REAL. A consumer's tsconfig `extends` this file, so the only honest
  //   check is to extend it and run tsc — not to read the JSON and assert on keys.
  await Bun.write(
    join(scratch, 'tsconfig.json'),
    JSON.stringify(
      { extends: '@homeflare/config/tsconfig.base.json', include: ['probe.ts'] },
      null,
      2,
    ),
  );
  await Bun.write(
    join(scratch, 'probe.ts'),
    `// ⚠️ noUncheckedIndexedAccess is one of the flags this preset exists to turn on. If the
//   extends silently failed, this would compile and the preset would be doing nothing.
const rows: string[] = ['a'];
const first: string | undefined = rows[0];
export const value: string = first ?? 'fallback';
`,
  );
  console.log('extending tsconfig.base.json and typechecking…');
  await run(['bunx', 'tsc', '--noEmit'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import { checkProject } from '@homeflare/config/check';

// The conformance checker is the one piece of CODE this package ships.
const problems = await checkProject(process.cwd());
if (!Array.isArray(problems)) throw new Error('checkProject did not return a list');
// This scratch project deliberately does NOT adopt the presets, so it must report some.
if (problems.length === 0) throw new Error('checkProject found nothing in an unconfigured project');

// Every non-code export must resolve as a real file.
for (const name of ['oxlintrc.json', 'oxfmtrc.json', 'tsconfig.base.json', 'tsconfig.lib.json', 'bunfig.toml']) {
  const path = Bun.resolveSync('@homeflare/config/' + name, process.cwd());
  const text = await Bun.file(path).text();
  if (text.trim().length === 0) throw new Error(name + ' resolved but is empty');
}

console.log('consumer ok —', problems.length, 'conformance problems reported, 5 config files resolve');
`,
  );
  console.log('importing and exercising…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\nconfig smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
