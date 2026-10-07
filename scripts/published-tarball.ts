/**
 * The registry's copy of one exact version of a package, as a content map (tarball-contents.ts).
 *
 * ⛔ A registry outage must fail the smoke test, never read as "unpublished" and quietly swap in a
 *   local tarball: 404 on the version is `null`, and any other non-200 throws.
 * ★ THE TARBALL URL COMES FROM THE VERSION'S OWN MANIFEST (`dist.tarball`), the one place npm says
 *   where it lives, and the download lands under `os.tmpdir()`, removed on every exit.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Contents, contentsOfTarball } from './tarball-contents.ts';

/** The contents of `name@version` as npm serves it, or null when npm has no such version. */
export async function publishedContents(
  name: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Contents | null> {
  const meta = await fetchImpl(
    `https://registry.npmjs.org/${name.replaceAll('/', '%2f')}/${encodeURIComponent(version)}`,
  );
  if (meta.status === 404) return null;
  if (meta.status !== 200) {
    throw new Error(`npm registry answered ${meta.status} for ${name}@${version}`);
  }
  const url = ((await meta.json()) as { dist?: { tarball?: unknown } }).dist?.tarball;
  if (typeof url !== 'string') throw new Error(`npm lists no tarball for ${name}@${version}`);
  const res = await fetchImpl(url);
  if (res.status !== 200) {
    throw new Error(`npm tarball answered ${res.status} for ${name}@${version}`);
  }
  const scratch = await mkdtemp(join(tmpdir(), 'published-tarball-'));
  try {
    const file = join(scratch, 'published.tgz');
    await Bun.write(file, await res.arrayBuffer());
    return await contentsOfTarball(file);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
