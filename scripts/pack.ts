/**
 * Pack one workspace package the way it will be PUBLISHED.
 *
 * ⛔ A PUBLISHED MANIFEST MUST NOT ADVERTISE COMMANDS IT CANNOT RUN. Measured 2026-09-15:
 *   an installed @homeflare/ui@0.2.0 offered `bun run smoke`, which exited 1 with
 *   "Module not found scripts/smoke.ts". `build` and `types` were equally broken —
 *   tsconfig.build.json does not ship either. An outside review found it, which means a
 *   consumer would have.
 * ★ The fix strips dev scripts rather than shipping the files: a consumer has no use for
 *   our build, and shipping scripts/ would put a test harness in every install.
 * ⚠️ publishConfig.scripts does NOT do this — `bun pm pack` ignores it (tested the same
 *   day). So the manifest is edited on disk, packed, and restored in a `finally`.
 *
 * ★ ONE PACK PATH FOR BOTH THE RELEASE AND THE SMOKE TESTS. That is the whole point: the
 *   smoke test must exercise the tarball a consumer receives, not a different one. When
 *   these were separate, the release stripped scripts and the smoke test did not, so the
 *   defect stayed invisible.
 */
export async function packForPublish(dir: string, destination: string): Promise<string> {
  const manifestPath = `${dir}/package.json`.replace(/\/+/g, '/');
  const original = await Bun.file(manifestPath).text();
  const forPublish = JSON.parse(original) as Record<string, unknown>;

  delete forPublish['scripts'];
  delete forPublish['devDependencies'];

  try {
    await Bun.write(manifestPath, `${JSON.stringify(forPublish, null, 2)}\n`);

    const proc = Bun.spawn(['bun', 'pm', 'pack', '--destination', destination, '--quiet'], {
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    if ((await proc.exited) !== 0) throw new Error(`pack failed in ${dir}\n${out}\n${err}`);

    const tarball = out.trim().split('\n').at(-1) ?? '';
    if (!tarball.endsWith('.tgz')) throw new Error(`no tarball from ${dir}: ${out}`);
    return tarball;
  } finally {
    // ⛔ ALWAYS restore, even when packing throws: a stripped manifest left behind would
    //   silently break the next build in this checkout.
    await Bun.write(manifestPath, original);
  }
}
