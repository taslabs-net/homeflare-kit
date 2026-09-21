/**
 * `@homeflare/site/load` — read the site file named by `HF_SITE_FILE`.
 *
 * ⛔ NODE / BUN ONLY: this subpath reads a file and spawns git. Workers use `decodeSite`
 *   from the main entry with JSON they already hold.
 *
 * ⛔ NO DEFAULT PATH, AND NO DEFAULT SITE. A missing `HF_SITE_FILE` refuses, naming the
 *   example. A fallback would plan someone's stack against whatever file happened to be
 *   there — or against the example's placeholder account.
 *
 * ★ PLAIN JSON, not JSONC: Nix, jq and Python read the same file, and none of them read
 *   comments.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as Cause from 'effect/Cause';
import * as Config from 'effect/Config';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Schema from 'effect/Schema';
import { checkoutProblem, readCheckout } from './checkout.ts';
import { decodeStrict, formatIssues, validateSite } from './decode.ts';
import { SiteError } from './errors.ts';
import { ENV_OVERRIDES, GUARD_FIELDS, SITE_FILE_VAR, pickOverrides } from './overrides.ts';
import { type Site, SiteSchema } from './schema.ts';

export { ENV_OVERRIDES, SITE_FILE_VAR } from './overrides.ts';
export { type CheckoutState, checkoutProblem, readCheckout } from './checkout.ts';

/** Where the refusal points people. Shipped in the tarball and exported by path. */
export const SITE_EXAMPLE = 'node_modules/@homeflare/site/site.example.json';

export interface LoadSiteOptions {
  /** Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Resolves a relative `HF_SITE_FILE`. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /**
   * Skip the committed-on-`main` check and accept `HF_SITE_*` overrides — what a
   * consumer's `--site-dev` flag sets. Without it, any accepted override refuses.
   */
  readonly siteDev?: boolean;
  /** The branch a reviewed site file lives on. Defaults to `main`. */
  readonly branch?: string;
  /** Test hook for the derive-version refusal. Defaults to the installed version. */
  readonly installed?: string;
}

export interface LoadedSite {
  readonly site: Site;
  /** The absolute path that was read. */
  readonly file: string;
  /** Which `HF_SITE_*` overrides changed the file's values. Print these; they are silent otherwise. */
  readonly overrides: readonly string[];
}

const SiteConfig = Config.schema(SiteSchema, 'site');

/**
 * ⚠️ `nested('hf')` MUST COME BEFORE `constantCase`. Measured 2026-09-21 on effect
 *   4.0.0-rc.115: each transformation sees the path the previous one produced, so the
 *   other order upper-cases `site.apex` to `SITE_APEX` and THEN prefixes a lower-case
 *   `hf` — the provider looks for `hf_SITE_APEX`, finds nothing, and the file's value
 *   wins. `HF_SITE_APEX` is ignored with no error at all. tests/load.test.ts measures both.
 */
function envProvider(accepted: Readonly<Record<string, string>>): ConfigProvider.ConfigProvider {
  return ConfigProvider.fromEnv({ env: accepted }).pipe(
    ConfigProvider.nested('hf'),
    ConfigProvider.constantCase,
  );
}

function withOverrides(json: unknown, accepted: Readonly<Record<string, string>>): Site {
  const provider = ConfigProvider.orElse(
    envProvider(accepted),
    ConfigProvider.fromUnknown({ site: json }),
  );
  const exit = Effect.runSyncExit(SiteConfig.parse(provider));
  if (Exit.isSuccess(exit)) return exit.value;
  const error = Cause.squash(exit.cause);
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error ? error.cause : error;
  if (Schema.isSchemaError(cause)) {
    throw new SiteError(
      'override',
      'an HF_SITE_* override is not a valid value',
      formatIssues(cause.issue, 'site').map(nameTheVariable),
    );
  }
  throw error;
}

/** `vault.port: …` → `HF_SITE_VAULT_PORT (vault.port): …`, so the fix names what to unset. */
function nameTheVariable(issue: string): string {
  for (const [name, path] of Object.entries(ENV_OVERRIDES)) {
    const dotted = path.join('.');
    if (issue.startsWith(`${dotted}: `)) return `${name} (${issue}`.replace(': ', '): ');
  }
  return issue;
}

async function readJson(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SiteError(
      'load',
      `${SITE_FILE_VAR} points at ${file}, which cannot be read: ${reason}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SiteError(
      'load',
      `${file} is not plain JSON (${reason}). Site files carry no comments and no trailing commas.`,
    );
  }
}

/**
 * Locate, check, read, decode and validate the site file.
 * Throws {@link SiteError}: `load`, `checkout`, `override`, `decode`, `reference`,
 * `derive-version`.
 */
export async function loadSite(options: LoadSiteOptions = {}): Promise<LoadedSite> {
  const env = options.env ?? process.env;
  const named = env[SITE_FILE_VAR]?.trim();
  if (named === undefined || named === '') {
    throw new SiteError(
      'load',
      `${SITE_FILE_VAR} is not set, and there is no default path. Start from the example: ` +
        `copy ${SITE_EXAMPLE}, replace every value, then export ${SITE_FILE_VAR}=<that file>.`,
    );
  }
  const file = resolve(options.cwd ?? process.cwd(), named);
  // ★ Read before the checkout check, so a mistyped path says "cannot be read" rather
  //   than "not committed" about a file that does not exist.
  const json = await readJson(file);

  if (options.siteDev !== true) {
    const branch = options.branch ?? 'main';
    const problem = checkoutProblem(await readCheckout(file), branch);
    if (problem !== undefined) {
      throw new SiteError(
        'checkout',
        `refusing ${file}: ${problem}. Live values come from a reviewed "${branch}"; ` +
          `pass --site-dev (siteDev: true) to load it anyway.`,
      );
    }
  }

  // ★ The file is decoded ALONE first, strictly, so its own errors name file paths and a
  //   misspelt key is refused before any override can paper over it.
  const fromFile = decodeStrict(json);

  const { accepted, refused } = pickOverrides(env);
  if (refused.length > 0) {
    throw new SiteError(
      'override',
      'unsupported HF_SITE_* variables; edit the site file instead',
      refused.map(
        (name) =>
          `${name}: not in ENV_OVERRIDES — records, lists and guard fields ` +
          `(${GUARD_FIELDS.join(', ')}) are never overridable`,
      ),
    );
  }
  const names = Object.keys(accepted);
  // ⛔ An override is an unreviewed value: same switch as the checkout guard (overrides.ts).
  if (names.length > 0 && options.siteDev !== true) {
    throw new SiteError(
      'override',
      'HF_SITE_* overrides change reviewed values, so they need --site-dev (siteDev: true); ' +
        'unset them, or edit the site file on a branch',
      names,
    );
  }
  const site = names.length === 0 ? fromFile : withOverrides(json, accepted);

  return { site: validateSite(site, options), file, overrides: names };
}
