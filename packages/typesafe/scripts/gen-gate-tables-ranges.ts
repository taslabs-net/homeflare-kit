/**
 * Parses the IANA IPv4 and IPv6 special-purpose registries into CIDR rows the gate can
 * check membership against, with a `refuseByDefault` flag chosen by a REVIEWED
 * CONSTANT, not the vendor data: Private-Use, Shared Address Space, Unique-Local and
 * the two link-local rows refuse by default; Loopback and every Documentation range are
 * recorded but only refuse when the caller opts in (`options.refuseLoopback` /
 * `refuseDocumentationRanges` in gate.ts) — an estate PR body legitimately quotes
 * `127.0.0.1` or `192.0.2.1` far more often than it leaks a real loopback-bound secret.
 */

export interface SpecialRange {
  readonly cidr: string;
  readonly name: string;
  readonly family: 4 | 6;
  readonly refuseByDefault: boolean;
  readonly category: 'default-refuse' | 'loopback' | 'documentation' | 'recorded-only';
}

const DEFAULT_REFUSE_NAMES = new Set([
  'Private-Use',
  'Shared Address Space',
  'Unique-Local',
  'Link Local',
  'Link-Local Unicast',
]);
const LOOPBACK_NAMES = new Set(['Loopback', 'Loopback Address']);

function categoryFor(name: string): SpecialRange['category'] {
  if (DEFAULT_REFUSE_NAMES.has(name)) return 'default-refuse';
  if (LOOPBACK_NAMES.has(name)) return 'loopback';
  if (name.startsWith('Documentation')) return 'documentation';
  return 'recorded-only';
}

/** Minimal RFC4180 field splitter: handles quoted fields with embedded commas,
 *  quotes (`""`) and newlines — the 255.255.255.255/32 row wraps its RFC column onto a
 *  second physical line inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((f) => f.length > 0)) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.length > 0)) rows.push(row);
  }
  return rows;
}

/** The first CIDR token in an "Address Block" cell — some rows list more than one
 *  (`"192.0.0.170/32, 192.0.0.171/32"`); the row is recorded once, under its first
 *  block, since the gate checks membership rather than needing every listed block. */
function firstCidr(cell: string): string | undefined {
  const cleaned = cell.replace(/\s*\[\d+\]\s*/g, '').trim();
  const first = cleaned.split(',')[0]?.trim();
  return first;
}

export function parseIanaCsv(text: string, family: 4 | 6): readonly SpecialRange[] {
  const rows = parseCsv(text);
  const [header, ...body] = rows;
  if (header === undefined) throw new Error('empty IANA registry CSV');
  const cidrIdx = header.indexOf('Address Block');
  const nameIdx = header.indexOf('Name');
  if (cidrIdx === -1 || nameIdx === -1) {
    throw new Error(
      `IANA registry CSV is missing 'Address Block' or 'Name' — header was: ${header.join('|')}`,
    );
  }

  const out: SpecialRange[] = [];
  for (const r of body) {
    const cidr = firstCidr(r[cidrIdx] ?? '');
    const name = (r[nameIdx] ?? '').replace(/\s*\[\d+\]\s*/g, '').trim();
    if (!cidr || !name) continue;
    const category = categoryFor(name);
    out.push({
      cidr,
      name,
      family,
      refuseByDefault: category === 'default-refuse',
      category,
    });
  }
  return out;
}
