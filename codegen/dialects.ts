/**
 * The vendor regex dialect table — which translator a product's patterns need, and whether the
 * vendor itself anchors them. Read [[param-rules.ts]] first: this file is the table that memo
 * calls out as "one table keyed by product" rather than a string every function switches on.
 *
 * ★ EXTRACTED HERE WHEN PAPERLESS BECAME THE SECOND OPENAPI VENDOR (2026-09-23). NetBox and
 *   Paperless-ngx are BOTH Django/DRF: same `RegexValidator` machinery, same `re.search`
 *   semantics, same Python `\w` widened over Unicode. A third vendor asks two questions —
 *   which dialect, and whether it anchors — and this is where both live so neither is forgotten
 *   the way `param-rules.ts`'s own header warns about.
 *
 * ⛔ NETBOX AND PAPERLESS DO NOT ANCHOR. Django's `RegexValidator` runs `re.search`, and both
 *   vendors' own patterns already carry `^…$` where they mean the whole string (measured over
 *   NetBox 4.7.0's 7 patterns and Paperless-ngx 3.1.1's schema, 2026-09-22 / 2026-09-23).
 *   Anchoring them again would be inventing a rule neither vendor has.
 * ⛔ PVE ANCHORS AND PBS DOES NOT — see param-rules.ts's own header for the measured Perl source
 *   (`PVE/JSONSchema.pm:1636`) this table does not restate.
 */
import type { TranslatedPattern } from './pattern.ts';
import { translatePattern } from './pattern.ts';
import { translateDjangoPattern } from './py-pattern.ts';

export type Product = 'pve' | 'pbs' | 'netbox' | 'paperless';

export interface Dialect {
  readonly translate: (source: string) => TranslatedPattern;
  /** ⚠️ PVE only: it matches `m/^$pattern$/`, so the published pattern is the INSIDE of that. */
  readonly anchor: boolean;
}

export const DIALECT: Readonly<Record<Product, Dialect>> = {
  netbox: { anchor: false, translate: translateDjangoPattern },
  paperless: { anchor: false, translate: translateDjangoPattern },
  pbs: { anchor: false, translate: translatePattern },
  pve: { anchor: true, translate: translatePattern },
};
