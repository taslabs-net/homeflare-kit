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
/**
 * 🔴 IN-PLACE EDITING OF A SHARED MANIFEST IS A RACE, AND IT DESTROYED ONE. Measured
 *   2026-09-16: `bun run --filter '*' smoke` runs every package's smoke test in PARALLEL,
 *   and both @homeflare/auth and @homeflare/cloudflare pack @homeflare/kit as a workspace
 *   dependency. Two processes stripped the same package.json, and the second restored the
 *   ALREADY-STRIPPED copy it had read — so kit's entire `scripts` block vanished from the
 *   working tree, survived `verify` (which had already run), and was committed.
 *
 * ⛔ SO THE REPOSITORY IS NEVER WRITTEN TO. The pack runs in the REAL package directory —
 *   it must, because `bun pm pack` resolves `workspace:*` through the lockfile and cannot
 *   do that from a copy ("Failed to resolve workspace version", measured the same day) —
 *   and the manifest is rewritten INSIDE the resulting tarball afterwards.
 * ⚠️ Concurrent packs of one package are therefore safe: each writes its own tarball, and
 *   `bun pm pack` only reads.
 */
export async function packForPublish(dir: string, destination: string): Promise<string> {
  // ⛔ cwd is the REAL package directory — `bun pm pack` resolves `workspace:*` through the
  //   lockfile and cannot do it from a copy. It only READS, so parallel packs are safe.
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

  await stripScriptsInTarball(tarball);
  return tarball;
}

/**
 * Strip dev-only fields from the manifest INSIDE a packed tarball.
 *
 * 🔴 IT MUST EDIT THE PACKED COPY, NOT THE ONE ON DISK. Measured 2026-09-16: writing the
 *   on-disk manifest into the tarball put `"@homeflare/kit": "workspace:*"` back, because
 *   that is what the source says — and `bun add` of the tarball then failed with
 *   "@homeflare/kit@workspace:* failed to resolve". `bun pm pack` has ALREADY replaced
 *   those with literal versions; that resolution is the thing being preserved here.
 *
 * ⚠️ Unpack, edit one file, repack — `tar` cannot substitute a member in place, and
 *   `--append` to a COMPRESSED archive is not supported either. The scratch directory is
 *   unique per call so concurrent packs cannot collide.
 * 🔴 `--no-mac-metadata` IS A bsdtar FLAG AND GNU tar REJECTS IT. Measured 2026-09-16: it
 *   worked on this Mac and failed on every CI runner ("Try 'tar --help'"), so the fix for
 *   one platform broke the other. It is passed only where tar accepts it — which is also
 *   the only place it is needed, since AppleDouble members are a macOS phenomenon.
 * ⚠️ Without it, bsdtar adds `._` members and the published tarball differs from CI's.
 */
async function stripScriptsInTarball(tarball: string): Promise<void> {
  const scratch = `${tarball}.rewrite-${Bun.randomUUIDv7()}`;
  const run = async (cmd: readonly string[]): Promise<void> => {
    const p = Bun.spawn([...cmd], {
      // ⚠️ The portable half of the AppleDouble defence: bsdtar honours COPYFILE_DISABLE,
      //   GNU tar ignores it, so it is safe to set everywhere.
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stderr = await new Response(p.stderr).text();
    if ((await p.exited) !== 0) throw new Error(`${cmd.join(' ')} failed\n${stderr}`);
  };

  try {
    await run(['mkdir', '-p', scratch]);
    await run(['tar', '-xzf', tarball, '-C', scratch]);

    const packedPath = `${scratch}/package/package.json`;
    // ⚠️ `.text()` then `JSON.parse`, not `.json()` — the Workers-types lib that the
    //   cloudflare and auth packages compile against narrows BunFile without it.
    const packed = JSON.parse(await Bun.file(packedPath).text()) as Record<string, unknown>;

    // ⛔ Only these two come out. Everything else — above all the dependency versions bun
    //   just resolved from the lockfile — is left exactly as packed.
    delete packed['scripts'];
    delete packed['devDependencies'];

    await Bun.write(packedPath, `${JSON.stringify(packed, null, 2)}\n`);
    // ⚠️ COPYFILE_DISABLE is the portable half: bsdtar honours it, GNU tar ignores it.
    //   The flag is added only on Darwin, where it exists.
    const macOnly = process.platform === 'darwin' ? ['--no-mac-metadata'] : [];
    await run(['tar', ...macOnly, '-czf', tarball, '-C', scratch, 'package']);
  } finally {
    await Bun.spawn(['rm', '-rf', scratch]).exited;
  }
}
