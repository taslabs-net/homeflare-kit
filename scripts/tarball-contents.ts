/**
 * What a packed package CONTAINS, as a map of file path to sha256, so two tarballs of one version
 * can be told apart by content and not by their manifests' dependency fields.
 *
 * ★ `package.json` IS COMPARED PARSED AND KEY-SORTED, not as bytes: a formatting or key-order
 *   difference must not read as a changed package. Every other file is compared byte for byte.
 * ⚠️ THE TARBALL'S OWN BYTES ARE NEVER COMPARED. Two packs of identical files differ in mtimes and
 *   gzip framing, so a whole-archive hash would call every sibling changed.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Glob } from 'bun';

export type Contents = ReadonlyMap<string, string>;

/** `value` with every object's keys sorted, so key order never reads as a difference. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, each]) => [key, canonical(each)]),
        )
      : value;

const sha256 = (bytes: Uint8Array | string): string =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

/** The file-to-hash map of a tarball, extracted under `os.tmpdir()` and removed on every exit. */
export async function contentsOfTarball(tarball: string): Promise<Contents> {
  const scratch = await mkdtemp(join(tmpdir(), 'tarball-contents-'));
  try {
    const p = Bun.spawn(['tar', '-xzf', tarball, '-C', scratch], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const err = await new Response(p.stderr).text();
    if ((await p.exited) !== 0) throw new Error(`tar extract of ${tarball} failed\n${err}`);
    const out = new Map<string, string>();
    for await (const rel of new Glob('**/*').scan({ cwd: scratch, dot: true, onlyFiles: true })) {
      const file = Bun.file(join(scratch, rel));
      // oxlint-disable-next-line no-await-in-loop
      const bytes = new Uint8Array(await file.arrayBuffer());
      out.set(
        rel,
        rel === 'package/package.json'
          ? sha256(JSON.stringify(canonical(JSON.parse(new TextDecoder().decode(bytes)))))
          : sha256(bytes),
      );
    }
    return out;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Whether two packs hold the same files with the same content. */
export function sameContents(a: Contents, b: Contents): boolean {
  if (a.size !== b.size) return false;
  for (const [path, hash] of a) if (b.get(path) !== hash) return false;
  return true;
}
