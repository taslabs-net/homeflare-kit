/**
 * How OPNsense's MVC model spells a value on the wire, and how to get it back to something
 * comparable — the `../proxmox/values.ts` idea, scoped to this vendor's own spellings.
 *
 * ★ OPNSENSE HAS EXACTLY TWO WIRE SHAPES THIS FAMILY NEEDS. Every `BooleanField` is the string
 *   `"1"` or `"0"` (never a JSON boolean — `AliasItem.enabled: string`, `GroupItem.nogroup?:
 *   string`, see `firewall_alias.ts`/`firewall_group.ts`). Every multi-select `OptionField`/
 *   `ModelRelationField` is a SINGLE comma-joined string, not a JSON array (`AliasItem.categories`,
 *   `GroupItem.members` — both carry the doc comment "wire value is a single comma-joined string,
 *   not a JSON array" in the generated SDK). Nothing here is specific to one resource.
 *
 * ⚠️ COMMA-LIST ORDER ROUND-TRIP IS NOT ASSUMED STABLE. OPNsense builds these from a PHP
 *   associative array (`ModelRelationField`/`OptionField::getNodeData()`), and nothing in the
 *   model XML promises the join order survives a save-then-read unchanged. Sorting and
 *   deduplicating both sides before comparing is what makes `matches` (alias-form.ts,
 *   group-form.ts) actually settle instead of reporting drift on a re-ordered list that changed
 *   nothing — the same reasoning `../proxmox/user-wire.ts`'s `groupSet` documents for PVE's
 *   `groups` field.
 */

/** OPNsense's own boolean spelling. Absent takes the caller's stated default — OPNsense's own
 * default for a `BooleanField` is form-specific, so there is no house-wide fallback here. */
export const bool01 = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value === '1';

/** The write direction, for symmetry — unused today (this family never writes), kept so a form
 * helper never has to guess the spelling if lifting the read-only policy adds one later. */
export const toBool01 = (value: boolean): string => (value ? '1' : '0');

/**
 * A comma-joined multi-select column, normalised to a sorted, deduplicated set — see the module
 * header's ⚠️ for why normalising (not just splitting) is what makes a diff settle.
 */
export const csvSet = (value: string | undefined): readonly string[] => {
  if (value === undefined || value.trim() === '') return [];
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return [...new Set(items)].sort();
};

/** A declared array, normalised the SAME way `csvSet` normalises the wire, so `matches` compares
 * two sets built by one function rather than trusting the caller's array to already be sorted. */
export const csvSetOf = (value: readonly string[] | undefined): readonly string[] =>
  csvSet(value === undefined ? undefined : value.join(','));

/**
 * OPNsense's numeric-as-string fields (`"60"`, `"0"`), tolerant of an already-numeric input the
 * same way `../proxmox/user-wire.ts`'s `int` is tolerant of PVE's mixed number/string releases.
 */
export const numField = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
