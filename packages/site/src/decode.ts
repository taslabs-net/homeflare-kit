/**
 * Decode a site from plain data. Runtime-neutral: no filesystem, no environment.
 *
 * ★ Workers and scripts that already hold the JSON (a binding, a fetched file) call
 *   `decodeSite`. Scripts that read `HF_SITE_FILE` call `loadSite` from
 *   `@homeflare/site/load`, which ends up here too.
 */
import * as Cause from 'effect/Cause';
import * as Exit from 'effect/Exit';
import * as Schema from 'effect/Schema';
import * as SchemaIssue from 'effect/SchemaIssue';
import { SiteError } from './errors.ts';
import { checkDeriveVersion } from './guards.ts';
import { referenceIssues } from './references.ts';
import { type Site, SiteSchema } from './schema.ts';
import { VERSION } from './version.ts';

/**
 * ⛔ `onExcessProperty: 'error'` IS LOAD-BEARING, twice over. Measured 2026-09-21 on
 *   effect 4.0.0-rc.115: with the default (`ignore`), a misspelt field is dropped, AND a
 *   record entry whose key fails the key schema (`"Mgmt"` in `networks`) is dropped too —
 *   the file decodes, one network short, with no error at all.
 * ⚠️ With it on, that bad record key reports as "excess property", which reads oddly.
 *   `formatIssues` rewrites it to say what it actually means.
 */
const strict = Schema.decodeUnknownExit(SiteSchema, { onExcessProperty: 'error', errors: 'all' });
const standard = SchemaIssue.makeFormatterStandardSchemaV1();

const EXCESS = 'Expected no excess property';

/**
 * `pinned.certificates["vault.origin"].0` — a key that itself holds a dot is bracketed,
 * or the path would read as two levels that do not exist.
 */
export function joinPath(segments: readonly string[]): string {
  return segments
    .map((segment, i) => {
      if (segment.includes('.')) return `[${JSON.stringify(segment)}]`;
      return i === 0 ? segment : `.${segment}`;
    })
    .join('');
}

/** Render a schema issue as `path: problem` lines, dropping a leading `skip` segment. */
export function formatIssues(issue: SchemaIssue.Issue, skip?: string): readonly string[] {
  return standard(issue).issues.map((entry) => {
    const segments = (entry.path ?? []).map((part) =>
      typeof part === 'object' && part !== null ? String(part.key) : String(part),
    );
    if (skip !== undefined && segments[0] === skip) segments.shift();
    const path = segments.length === 0 ? '(root)' : joinPath(segments);
    const message =
      entry.message === EXCESS
        ? 'unknown key (a misspelt field, or a record key that is not a lowercase label)'
        : entry.message;
    return `${path}: ${message}`;
  });
}

/** Schema-only decode. Throws `decode` listing every problem, each with its path. */
export function decodeStrict(input: unknown): Site {
  const exit = strict(input);
  if (Exit.isSuccess(exit)) return exit.value;
  const error = Cause.squash(exit.cause);
  if (Schema.isSchemaError(error)) {
    throw new SiteError(
      'decode',
      'the site file does not match the schema',
      formatIssues(error.issue),
    );
  }
  throw error;
}

export interface ValidateOptions {
  /**
   * The `@homeflare/site` version to hold `deriveVersion` against. Defaults to the
   * installed one — which is the point; override only to test the refusal.
   */
  readonly installed?: string;
}

/** Cross-field references, then the derive-version guard. Returns the same site. */
export function validateSite(site: Site, options: ValidateOptions = {}): Site {
  const issues = referenceIssues(site);
  if (issues.length > 0) {
    throw new SiteError('reference', 'the site file names things it does not declare', issues);
  }
  checkDeriveVersion(site, options.installed ?? VERSION);
  return site;
}

/**
 * Decode and validate a site from plain data (already-parsed JSON).
 * Throws {@link SiteError}: `decode`, `reference` or `derive-version`.
 */
export function decodeSite(input: unknown, options: ValidateOptions = {}): Site {
  return validateSite(decodeStrict(input), options);
}
