/**
 * Put generated artefacts through the repository's own formatter before they are written.
 *
 * ⛔ WITHOUT THIS, `bun run check` FAILS AFTER EVERY REGENERATION. `oxfmt` formats markdown and
 *   JSON, not just TypeScript: it aligns table columns, turns `*emphasis*` into `_emphasis_`, and
 *   collapses short JSON arrays onto one line. A generator that emits its own spacing is therefore
 *   permanently at odds with `bun run lint`, and the person regenerating gets a lint failure that
 *   has nothing to do with their change.
 *
 * ★ SO ONE HELPER FORMATS, AND BOTH CALLERS USE IT — the generator before writing, and
 *   `tests/api-coverage.test.ts` before comparing. If they used different text, the byte-for-byte
 *   staleness check would be comparing the formatter against the renderer rather than the
 *   committed file against the schema.
 *
 * ⚠️ `--stdin-filepath` IS HOW oxfmt PICKS A PARSER. There is no `--parser` flag; the extension in
 *   that path is the whole signal, so `x.md` and `x.json` are the arguments, not real files.
 */
import { join } from 'node:path';

export const formatAs = async (
  repoRoot: string,
  source: string,
  filename: string,
): Promise<string> => {
  const bin = join(repoRoot, 'node_modules', '.bin', 'oxfmt');
  if (!(await Bun.file(bin).exists())) {
    throw new Error(`${bin} is missing — run \`bun install\` before generating or checking.`);
  }
  const proc = Bun.spawn([bin, `--stdin-filepath=${filename}`], {
    stderr: 'pipe',
    stdin: new TextEncoder().encode(source),
    stdout: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`oxfmt failed on ${filename} (exit ${String(code)}): ${err}`);
  return out;
};
