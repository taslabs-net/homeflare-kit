/**
 * Rendering the Paperless constraint tables — the DATA path shared with `emit.ts`, `render.ts`'s
 * own reasoning restated for this vendor's prose. See `netbox-render.ts`'s own header for why a
 * vendor gets its own words rather than sharing PVE/PBS's: the ⚠️/⛔ lines are facts about THIS
 * vendor, and printing NetBox's over Paperless tables would say things that are false here.
 */
import { type EmittedParam, digest } from './emit.ts';

export interface PaperlessManifestEntry {
  readonly id: string;
  readonly product: string;
  readonly version: string;
  readonly sourceRole: string;
  readonly sourcePath: string;
  readonly sha256: string;
}

export const CAP = 250;

/** `paperless:POST /api/tags/` -> `tags`. One generated file per Paperless area. */
export const areaOf = (key: string): string => (key.split(' ')[1] ?? '/').split('/')[2] ?? 'root';

export const constName = (area: string): string =>
  `PAPERLESS_${area.toUpperCase().replaceAll('-', '_')}_CONSTRAINTS`;

const header = (
  entry: PaperlessManifestEntry,
  area: string,
  covered: number,
  total: number,
): string =>
  `/**
 * Generated ${entry.product} request-body constraints for \`/api/${area}/\` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/paperless.ts
 * Manifest entry: \`${entry.id}\` — ${entry.product} ${entry.version}
 *   sha256 ${entry.sha256.slice(0, 16)}, ${entry.sourceRole}
 *   ${entry.sourcePath}
 *
 * ${covered} of this product's ${total} POST/PUT/PATCH/DELETE endpoints are tabled across all
 * areas: the ones this package writes to, named in its own source. Every other vendor write
 * endpoint is UNTABLED and therefore unchecked at plan time.
 *
 * ⚠️ A \`patternSource\` with no \`pattern\` beside it could NOT be carried into a JavaScript
 *   RegExp faithfully — Django/DRF's \`\\w\` is Unicode and JavaScript's is ASCII
 *   (codegen/py-pattern.ts). It is recorded and NOT enforced.
 * ⚠️ \`data_type\` on a custom field is CREATE-ONLY: enforced here as a value rule, never as a
 *   reason to allow a PATCH — the refusal on change lives in the provider (custom-field.ts).
 */
import type { EndpointConstraints } from '../../constraints.ts';
`;

export const render = (
  entry: PaperlessManifestEntry,
  area: string,
  tables: Readonly<Record<string, Readonly<Record<string, EmittedParam>>>>,
  covered: number,
  total: number,
): string => {
  const body = Object.keys(tables)
    .sort()
    .map((key) => {
      const rows = Object.entries(tables[key] ?? {})
        .map(([param, rule]) => `    ${JSON.stringify(param)}: ${JSON.stringify(rule)},`)
        .join('\n');
      return `  ${JSON.stringify(key)}: {${rows === '' ? '' : `\n${rows}\n  `}},`;
    })
    .join('\n');
  return `${header(entry, area, covered, total)}
export const ${constName(area)}: Readonly<Record<string, EndpointConstraints>> = {
${body}
};
`;
};

/** ⛔ THE MERGE IS GENERATED TOO — a hand-written index is one forgotten import away from a table nobody consults. */
export const renderIndex = (
  modules: readonly { readonly file: string; readonly constant: string }[],
  overall: string,
): string =>
  `/**
 * Every generated Paperless constraint table, merged — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/paperless.ts
 *
 * ⚠️ EVERY KEY IS PREFIXED \`paperless:\`, so one estate running several vendors' readers cannot
 *   collide on an unprefixed \`POST /api/…\`.
 */
import type { EndpointConstraints } from '../../constraints.ts';
${modules.map((m) => `import { ${m.constant} } from './${m.file}';`).join('\n')}

export const PAPERLESS_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
${modules.map((m) => `  ...${m.constant},`).join('\n')}
};

/** sha256 of the merged table, truncated — a digest of the DATA, not the file text. */
export const PAPERLESS_CONSTRAINTS_DIGEST = '${overall}';
`;

export interface CoverageRow {
  readonly key: string;
  readonly source: string;
  readonly params: number;
  readonly enforced: number;
  readonly recordedOnly: number;
}

export interface CoverageInput {
  readonly entry: PaperlessManifestEntry;
  readonly rows: readonly CoverageRow[];
  readonly writeEndpoints: number;
  readonly writePaths: number;
  readonly areas: readonly { readonly area: string; readonly endpoints: number }[];
  readonly digest: string;
}

export { digest };
