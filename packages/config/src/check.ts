/**
 * Assert that a project still stands on the shared config.
 *
 * ★ WHY THIS EXISTS. Two of the five presets — `.oxfmtrc.json` and `bunfig.toml` — have no
 *   `extends` mechanism, so adopting them means COPYING them. A copy drifts silently: the
 *   project keeps building, the rules quietly diverge, and nobody finds out until two
 *   repos disagree about how the same code should look.
 *
 * ⛔ IT REPORTS, IT DOES NOT REPAIR. A checker that rewrites a project's config would
 *   overwrite a deliberate local exception, and this cannot tell the difference between
 *   drift and a decision. It names what differs; a human decides which way to move.
 *
 * ⚠️ Every file it reads is parsed natively — `Bun.file().json()`, `Bun.TOML.parse`. No
 *   parsing dependency reaches a consumer.
 *   ⛔ NOT JSONC. Bun's `.json()` rejects comments (measured 2026-09-15), so a project
 *     whose tsconfig carries them is reported as unreadable rather than silently skipped.
 */
import { type OxfmtConfig, problemsInOxfmt } from './oxfmt.ts';

/** One thing a project should fix, in the imperative. */
export type Problem = string;

type Json = Record<string, unknown>;

/**
 * ⚠️ A tsconfig LEGITIMATELY carries comments — that is where the reasoning for a strict
 *   flag lives, and stripping them to satisfy a parser would be the wrong trade. Bun's
 *   `.json()` rejects them (measured 2026-09-15), so comments are removed before parsing
 *   rather than treated as a fault.
 * 🔴 A NAIVE REGEX CORRUPTS THE FILE IT IS READING. Measured while writing this: a
 *   `(^|[^:"])//.*$` strip mangled `"./node_modules/oxlint/..."` — the `//` inside a
 *   STRING — turning valid JSON into a parse error reported as "JSONC not supported".
 *   So this walks the text and tracks whether it is inside a string, which is the
 *   smallest correct thing; a real JSONC parser would be a dependency every consumer
 *   inherits for one check.
 */
function stripComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    const next = text[i + 1] ?? '';

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      out += ch;
    }
  }

  return out;
}

async function readJson(path: string): Promise<Json | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  try {
    return JSON.parse(stripComments(await file.text())) as Json;
  } catch {
    return undefined;
  }
}

/** Where this package's own presets live, however it was installed. */
function presetDir(): string {
  return new URL('../', import.meta.url).pathname;
}

async function checkExtends(
  projectDir: string,
  file: string,
  needle: string,
  problems: Problem[],
): Promise<void> {
  const config = await readJson(`${projectDir}/${file}`);
  if (config === undefined) {
    problems.push(`${file}: missing or unparseable (JSONC comments are not supported)`);
    return;
  }

  const extended = JSON.stringify(config['extends'] ?? '');

  // ⚠️ A WORKSPACE PATH COUNTS. Inside this repo the presets are referenced as
  //   `./packages/config/...` rather than by package name, and reporting that as drift
  //   would make the check fail in the one repo that defines the config.
  const workspacePath = needle.replace('@homeflare/config/', 'packages/config/');
  if (!extended.includes(needle) && !extended.includes(workspacePath)) {
    problems.push(`${file}: does not extend ${needle} — it currently extends ${extended}`);
  }
}

/**
 * Compare a copied file against the preset, ignoring formatting.
 * ⚠️ Structural comparison, not text: a project that reformats its copy has not drifted,
 *   and reporting that would train people to ignore this check.
 */
async function checkCopy(
  projectDir: string,
  file: string,
  parse: (text: string) => unknown,
  problems: Problem[],
): Promise<void> {
  const mine = Bun.file(`${projectDir}/${file}`);
  if (!(await mine.exists())) {
    problems.push(`${file}: missing — copy it from @homeflare/config`);
    return;
  }

  const preset = parse(await Bun.file(`${presetDir()}${file.replace(/^\./, '')}`).text());
  const theirs = parse(await mine.text());

  if (JSON.stringify(theirs) !== JSON.stringify(preset)) {
    problems.push(`${file}: differs from @homeflare/config — re-copy it, or say why it differs`);
  }
}

/**
 * House oxfmt has no `extends`. Extra ignores are a merge; style keys are not.
 * ⛔ Identity comparison rewrote generated OpenAPI (measured 2026-09-16).
 */
async function checkOxfmt(projectDir: string, problems: Problem[]): Promise<void> {
  const mine = Bun.file(`${projectDir}/.oxfmtrc.json`);
  if (!(await mine.exists())) {
    problems.push('.oxfmtrc.json: missing — copy it from @homeflare/config');
    return;
  }

  let theirs: OxfmtConfig;
  try {
    theirs = JSON.parse(await mine.text()) as OxfmtConfig;
  } catch {
    problems.push('.oxfmtrc.json: unparseable');
    return;
  }

  const preset = JSON.parse(await Bun.file(`${presetDir()}oxfmtrc.json`).text()) as OxfmtConfig;
  problems.push(...problemsInOxfmt(preset, theirs));
}

/**
 * Check a project directory. Returns an empty array when everything is in step.
 *
 *     const problems = await checkProject(process.cwd());
 *     expect(problems).toEqual([]);
 */
export async function checkProject(projectDir: string): Promise<readonly Problem[]> {
  const problems: Problem[] = [];

  await checkExtends(projectDir, 'tsconfig.json', '@homeflare/config/tsconfig', problems);
  await checkExtends(projectDir, '.oxlintrc.json', '@homeflare/config/oxlintrc', problems);
  await checkOxfmt(projectDir, problems);
  await checkCopy(projectDir, 'bunfig.toml', (t) => Bun.TOML.parse(t), problems);

  return problems;
}
