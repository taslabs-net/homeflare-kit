/**
 * Which `.oxfmtrc.*` file governs this repo — so the hook can name it explicitly.
 *
 * ⛔ BUG, MEASURED 2026-09-23 (homeflare-desktop docs agent): the shared pre-commit ran
 *   bare `oxfmt`, and bare `oxfmt` auto-discovers only `.oxfmtrc.json` and `.oxfmtrc.jsonc`.
 *   Checked against the pinned oxfmt 0.68.0 directly: a repo with only `.oxfmtrc.mjs` and
 *   no `-c` prints "No config found, using defaults" and formats with oxfmt's built-in
 *   style, silently — even though `oxfmt --help` lists `.ts/.mts/.cts/.js/.mjs/.cjs` as
 *   valid `--config` targets. Desktop's fix was renaming to `.oxfmtrc.json`; this fixes the
 *   hook so a repo does not have to.
 * ★ WHY A FILE SCAN, NOT A PACKAGE.JSON READ. The repo's own `format`/`check` script names
 *   the config it wants (or relies on auto-discovery finding `.oxfmtrc.json`), but its exact
 *   invocation shape varies per repo. Finding the config file on disk and handing it to
 *   oxfmt directly gets the same result without parsing an arbitrary shell command.
 * ⛔ EVERY `.oxfmtrc.*` LIVES AT THE REPO ROOT TODAY (checked: every repo in the estate has
 *   exactly one, at root — no nested per-package overrides). Explicit `-c` disables oxfmt's
 *   own nested-config search (measured: a nested `.oxfmtrc.json` was ignored once `-c` named
 *   the root one), so this only scans `root` itself — it would misfire on a repo that added a
 *   package-level override, which none currently do.
 */
import { readdir } from 'node:fs/promises';

/** Auto-discovered by bare `oxfmt` — nothing for the hook to pass. */
const AUTO_DISCOVERED = ['.oxfmtrc.json', '.oxfmtrc.jsonc'];

/**
 * Accepted by `oxfmt -c/--config` (per `oxfmt --help`, oxfmt 0.68.0) but never found on its
 * own — checked empirically for each extension. Listed in the order `--help` documents them.
 */
const NEEDS_EXPLICIT_CONFIG = [
  '.oxfmtrc.ts',
  '.oxfmtrc.mts',
  '.oxfmtrc.cts',
  '.oxfmtrc.js',
  '.oxfmtrc.mjs',
  '.oxfmtrc.cjs',
];

export type OxfmtConfigResolution =
  /** `.oxfmtrc.json` or `.oxfmtrc.jsonc` exists — bare oxfmt already finds it. */
  | { readonly kind: 'auto' }
  /** No `.oxfmtrc.*` at all — let oxfmt use its built-in defaults, as today. */
  | { readonly kind: 'none' }
  /** Exactly one config oxfmt would not find unaided — pass it with `-c`. */
  | { readonly kind: 'explicit'; readonly path: string }
  /**
   * Two or more configs, none of them auto-discovered — bare oxfmt (and a repo's own
   * bare `bun run format`) would silently fall back to defaults too, honouring neither.
   * Guessing which one the repo meant would just move the silent-defaults bug here.
   */
  | { readonly kind: 'ambiguous'; readonly files: readonly string[] };

/** Every `.oxfmtrc.*` file actually present at `root`, in a fixed, deterministic order. */
async function present(root: string, names: readonly string[]): Promise<readonly string[]> {
  const entries = new Set(await readdir(root).catch(() => []));
  return names.filter((name) => entries.has(name));
}

export async function resolveOxfmtConfig(root: string): Promise<OxfmtConfigResolution> {
  if ((await present(root, AUTO_DISCOVERED)).length > 0) return { kind: 'auto' };

  const explicit = await present(root, NEEDS_EXPLICIT_CONFIG);
  const [only, ...rest] = explicit;
  if (only === undefined) return { kind: 'none' };
  if (rest.length === 0) return { kind: 'explicit', path: `${root}/${only}` };
  return { kind: 'ambiguous', files: explicit };
}
