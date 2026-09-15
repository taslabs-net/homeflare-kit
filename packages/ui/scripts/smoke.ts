/**
 * Consumer smoke test: pack the real tarball, install it beside Kumo, and prove all four
 * things a consumer depends on.
 *
 * ⛔ THE PLACEHOLDER THIS REPLACES SAID `echo 'needs a DOM harness'` AND EXITED 0. A smoke
 *   test that cannot fail is worse than none: it reads as coverage in CI and in review
 *   while proving nothing. An outside reviewer flagged exactly that.
 *
 * ★ FOUR CHECKS, EACH FOR A FAILURE THE OTHERS MISS:
 *     1. JS resolves and VERSION is a real string        — the entrypoint loads
 *     2. `@homeflare/ui/styles` resolves and contains the @import — the CSS export works
 *     3. tsc --noEmit from the consumer side              — the .d.ts is usable
 *     4. a Kumo component actually RENDERS to HTML        — the peer contract holds
 *
 * ⚠️ Check 4 is the one with teeth. Kumo is a PEER, so a version conflict or a missing
 *   peer surfaces only when React tries to render one of its components — not at install.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pkgRoot = new URL('../', import.meta.url).pathname;

async function run(cmd: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ui smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-ui-smoke-'));

try {
  console.log('packing…');
  // ⛔ bun pm pack, not npm pack: it resolves `catalog:` and `workspace:` specifiers.
  const packed = (
    await run(['bun', 'pm', 'pack', '--destination', scratch, '--quiet'], pkgRoot)
  ).trim();
  const tarball = packed.split('\n').at(-1) ?? '';

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'ui-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing tarball beside its peers…');
  await run(
    [
      'bun',
      'add',
      tarball,
      '@cloudflare/kumo@2.13.2',
      'react@19.3.0',
      'react-dom@19.3.0',
      '@phosphor-icons/react@2.1.10',
    ],
    scratch,
  );

  // 1 + 2: the JS entrypoint and the CSS export.
  await Bun.write(
    join(scratch, 'resolve.ts'),
    `import { VERSION } from '@homeflare/ui';

if (typeof VERSION !== 'string' || VERSION.length === 0) throw new Error('VERSION missing');

// ⚠️ Resolved as a PATH, not imported: bun would try to parse the CSS as a module.
//   What matters is that the export map points somewhere real.
const css = await Bun.file(Bun.resolveSync('@homeflare/ui/styles', process.cwd())).text();
if (!css.includes("@import '@cloudflare/kumo/styles'")) throw new Error('styles missing Kumo import');
if (!css.includes('--hf-')) throw new Error('styles missing HomeFlare tokens');

console.log('resolve ok', VERSION);
`,
  );
  console.log(await run(['bun', 'resolve.ts'], scratch));

  // 3: the published types, checked the way a consumer checks them.
  await Bun.write(
    join(scratch, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'preserve',
          moduleResolution: 'bundler',
          target: 'esnext',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          lib: ['ESNext', 'DOM'],
        },
        include: ['types.tsx'],
      },
      null,
      2,
    ),
  );
  await Bun.write(
    join(scratch, 'types.tsx'),
    `import { VERSION } from '@homeflare/ui';
import { Button } from '@cloudflare/kumo/components/button';

export const version: string = VERSION;
export const el = <Button>go</Button>;
`,
  );
  console.log('typechecking as a consumer…');
  await run(['bun', 'add', '-d', 'typescript@7.0.2', '@types/react@19.3.0'], scratch);
  await run(['bunx', 'tsc', '--noEmit'], scratch);

  // 4: a Kumo component really renders. This is what proves the peer contract.
  await Bun.write(
    join(scratch, 'render.tsx'),
    `import { renderToString } from 'react-dom/server';
import { Button } from '@cloudflare/kumo/components/button';

const html = renderToString(<Button>Deploy</Button>);
if (!html.includes('Deploy')) throw new Error('Kumo did not render: ' + html);
if (!html.includes('<button')) throw new Error('not a button: ' + html);

console.log('render ok');
`,
  );
  console.log('rendering a Kumo component…');
  console.log(await run(['bun', 'render.tsx'], scratch));

  console.log('\nui smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
