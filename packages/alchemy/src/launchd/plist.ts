/**
 * An XML property list serializer — the subset launchd.plist(5) reads, and nothing else.
 *
 * ★ WHY NOT AN npm LIBRARY. Nothing in this workspace depends on one (checked 2026-09-21: no
 *   `plist`, `xmlbuilder` or `@xmldom/xmldom` anywhere under node_modules), and the common one pulls
 *   an XML DOM in for PARSING, which a provider that only RENDERS never does. The subset a launchd
 *   job needs is five node types, so this is ~100 lines plus exhaustive tests (plist.test.ts), which
 *   also round-trip every case through Apple's own `plutil` when the tests run on macOS.
 *
 * ⛔ THE OUTPUT MUST BE DETERMINISTIC. LaunchdJob diffs by the SHA-256 of these bytes, so two
 *   renders of one declaration must be byte-identical: dict keys are sorted, indentation is fixed,
 *   and nothing depends on insertion order. A non-deterministic render is a forever-`update`.
 * ⚠️ AND A CHANGE TO THIS FILE'S OUTPUT RESTARTS EVERY JOB. A new header, indent or escape changes
 *   every digest, so the next deploy after the kit upgrade updates — restarts — every declared
 *   job at once. Treat any byte change here as a breaking change and say so in its changeset.
 *
 * ⛔ REFUSE, NEVER COERCE. `undefined`, `null`, a fraction, NaN, a class instance or a character XML
 *   1.0 cannot carry is a thrown PlistError naming the path, not a silently dropped key. A dropped
 *   `KeepAlive` is a daemon that never restarts, and nothing downstream would say why.
 */

/** Every value launchd reads. ⚠️ No `<real>`, `<date>` or `<data>`: no launchd key needs one. */
export type PlistValue =
  | string
  | number
  | boolean
  | readonly PlistValue[]
  | { readonly [key: string]: PlistValue };

export type PlistDict = { readonly [key: string]: PlistValue };

export class PlistError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`plist ${path === '' ? '(root)' : path}: ${detail}`);
    this.name = 'PlistError';
  }
}

const HEADER =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
  '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  '<plist version="1.0">\n';

/** ⚠️ A cycle, or a runaway generator, would otherwise recurse until the stack dies. */
const MAX_DEPTH = 32;

/**
 * ⛔ CHARACTERS XML 1.0 CANNOT CARRY AT ALL — not even escaped (XML 1.0 §2.2 `Char`). C0 controls
 *   other than tab, LF and CR; U+FFFE / U+FFFF; and an unpaired surrogate, which has no UTF-8 form.
 */
// ★ The `u` flag makes a VALID surrogate pair one code point above U+FFFF, outside this class, so
//   only an unpaired half matches the \uD800-\uDFFF range.
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const FORBIDDEN = /[\x00-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF\uFFFE\uFFFF]/u;

/**
 * Escape text content.
 * ⚠️ CR IS A CHARACTER REFERENCE, NOT A LITERAL. An XML parser normalises a literal CR (and CRLF)
 *   to LF before the application sees it (XML 1.0 §2.11), so `a\r\nb` would come back as `a\nb` and
 *   the argument launchd passes would differ from the one declared. `&#13;` survives normalisation.
 */
export const escapeText = (text: string, path: string): string => {
  const bad = FORBIDDEN.exec(text);
  if (bad !== null) {
    const code = bad[0].codePointAt(0) ?? 0;
    throw new PlistError(
      path,
      `U+${code.toString(16).toUpperCase().padStart(4, '0')} cannot appear in XML 1.0`,
    );
  }
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;');
};

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

const renderValue = (value: unknown, path: string, depth: number, out: string[]): void => {
  const pad = '\t'.repeat(depth);
  if (depth > MAX_DEPTH) throw new PlistError(path, `nested deeper than ${String(MAX_DEPTH)}`);
  if (typeof value === 'string') {
    out.push(`${pad}<string>${escapeText(value, path)}</string>`);
    return;
  }
  if (typeof value === 'boolean') {
    out.push(`${pad}<${value ? 'true' : 'false'}/>`);
    return;
  }
  if (typeof value === 'number') {
    // ⛔ launchd reads every numeric key as an integer; 1.5 would be a silently different job.
    if (!Number.isSafeInteger(value)) {
      throw new PlistError(path, `${String(value)} is not a safe integer (no <real> support)`);
    }
    out.push(`${pad}<integer>${String(value === 0 ? 0 : value)}</integer>`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(`${pad}<array/>`);
      return;
    }
    out.push(`${pad}<array>`);
    for (const [index, item] of (value as readonly unknown[]).entries()) {
      renderValue(item, `${path}[${String(index)}]`, depth + 1, out);
    }
    out.push(`${pad}</array>`);
    return;
  }
  if (typeof value === 'object' && value !== null && isPlainObject(value)) {
    renderDict(value as Record<string, unknown>, path, depth, out);
    return;
  }
  const kind = value === null ? 'null' : typeof value;
  throw new PlistError(path, `${kind} has no plist form — omit the key instead`);
};

const renderDict = (
  dict: Record<string, unknown>,
  path: string,
  depth: number,
  out: string[],
): void => {
  const pad = '\t'.repeat(depth);
  // ★ Code-unit order, not localeCompare: the same bytes on every machine and every locale.
  const keys = Object.keys(dict).sort();
  if (keys.length === 0) {
    out.push(`${pad}<dict/>`);
    return;
  }
  out.push(`${pad}<dict>`);
  for (const key of keys) {
    const child = path === '' ? key : `${path}.${key}`;
    out.push(`${pad}\t<key>${escapeText(key, child)}</key>`);
    renderValue(dict[key], child, depth + 1, out);
  }
  out.push(`${pad}</dict>`);
};

/** Render a top-level dict as a complete XML plist document, ending in a newline. */
export const renderPlist = (dict: PlistDict): string => {
  if (typeof dict !== 'object' || dict === null || Array.isArray(dict) || !isPlainObject(dict)) {
    throw new PlistError('', 'the top level of a launchd plist must be a dict');
  }
  const out: string[] = [];
  renderDict(dict as Record<string, unknown>, '', 0, out);
  return `${HEADER}${out.join('\n')}\n</plist>\n`;
};
