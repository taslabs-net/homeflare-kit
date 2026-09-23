/**
 * Consumer smoke test: pack, install, and USE every published export.
 *
 * 🔴 WHY THIS REPLACES AN `echo`. The old script pointed at an in-repo test, which cannot
 *   see what a CONSUMER sees: this package ships JSON/TOML files behind an export
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

  // ⛔ THE APP PRESET EXISTS BECAUSE SOURCE-PUBLISHING DEPS FAIL UNDER THE BASELINE.
  //   `{ a?: string } = { a: undefined }` is illegal under exactOptionalPropertyTypes
  //   and legal under tsconfig.app.json. If this compile fails, the preset is not
  //   doing the one job it exists for.
  await Bun.write(
    join(scratch, 'tsconfig.json'),
    JSON.stringify(
      { extends: '@homeflare/config/tsconfig.app.json', include: ['optional.ts'] },
      null,
      2,
    ),
  );
  await Bun.write(
    join(scratch, 'optional.ts'),
    `type Opts = { a?: string };
export const opts: Opts = { a: undefined };
`,
  );
  console.log('extending tsconfig.app.json and typechecking a source-publishing-shaped assign…');
  await run(['bunx', 'tsc', '--noEmit'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import { checkProject } from '@homeflare/config/check';
import { shouldRelease, tagEvent } from '@homeflare/config/release';
import { problemsInHooks } from '@homeflare/config/hooks';
import { problemsInReleaseConfig } from '@homeflare/config/require-release-config';
import { ESTATE_VERSIONS } from '@homeflare/config/versions';
import { BUN_VERSION } from '@homeflare/config/repo-shape';

const problems = await checkProject(process.cwd());
if (!Array.isArray(problems)) throw new Error('checkProject did not return a list');
// This scratch project deliberately does NOT adopt the presets, so it must report some.
if (problems.length === 0) throw new Error('checkProject found nothing in an unconfigured project');

// ⛔ These two exports are how non-npm apps cut a GitHub Release. A missing
//   export map entry would pass every in-repo test and fail the first consumer.
const event = tagEvent({ name: 'smoke-app', version: '0.1.0' });
if (event.tag !== 'smoke-app@0.1.0') throw new Error('tagEvent shape drifted');
const skipped = await shouldRelease(process.cwd(), { name: 'smoke-app', version: '0.1.0' });
if (skipped.ok) throw new Error('shouldRelease proceeded without a CHANGELOG.md');
// ⚠️ Scratch package.json is private with no version — that path would also try
//   to read changeset config. The published package is public and has a version.
const releaseProblems = await problemsInReleaseConfig({
  pkgPath: Bun.resolveSync('@homeflare/config/package.json', process.cwd()),
  changesetConfigPath: new URL('./missing.json', import.meta.url).pathname,
});
if (releaseProblems.length !== 0) throw new Error('problemsInReleaseConfig failed a public package');

// ⛔ THE HOOK RUNNER IS NOT AN EXPORT — a repo's .husky wrapper reaches it by PATH,
//   so an \`exports\` map cannot protect it. If \`files\` ever drops "bin" or "src", every
//   repo in the estate silently loses its hooks and nothing else fails.
const runner = process.cwd() + '/node_modules/@homeflare/config/bin/hooks.ts';
if (!(await Bun.file(runner).exists())) throw new Error('bin/hooks.ts is not in the tarball');
const install = Bun.spawn(['bun', runner, 'install'], { cwd: process.cwd(), stderr: 'pipe' });
if ((await install.exited) !== 0) throw new Error('the published hook runner cannot install hooks');
if ((await problemsInHooks(process.cwd())).length === 0) {
  throw new Error('problemsInHooks passed a project with no prepare script');
}

// ⛔ The estate's version set is only useful if a consumer can read it from the tarball.
if (ESTATE_VERSIONS.bun !== BUN_VERSION) throw new Error('ESTATE_VERSIONS.bun drifted from BUN_VERSION');
if (!/^\\d+\\.\\d+\\.\\d+/.test(ESTATE_VERSIONS.alchemy)) throw new Error('ESTATE_VERSIONS.alchemy is not a version');

// Every non-code export must resolve as a real file.
for (const name of ['oxlintrc.json', 'oxlintrc.app.json', 'oxfmtrc.json', 'tsconfig.base.json', 'tsconfig.lib.json', 'tsconfig.app.json', 'bunfig.toml']) {
  const path = Bun.resolveSync('@homeflare/config/' + name, process.cwd());
  const text = await Bun.file(path).text();
  if (text.trim().length === 0) throw new Error(name + ' resolved but is empty');
}

console.log('consumer ok —', problems.length, 'conformance problems, 7 config files, hook runner installs');
`,
  );
  console.log('importing and exercising…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\nconfig smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
