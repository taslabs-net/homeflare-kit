/**
 * How OPNsense's MVC model spells a value on the wire, and how to get it back to something
 * comparable — the `../proxmox/values.ts` idea, scoped to this vendor's own spellings.
 *
 * ★ OPNSENSE HAS EXACTLY TWO WIRE SHAPES THIS FAMILY NEEDS ON WRITE (props stay plain values;
 *   this family never writes, but `matches` compares against them). Every `BooleanField` is the
 *   string `"1"` or `"0"` (never a JSON boolean). Every multi-select `OptionField`/
 *   `ModelRelationField`'s WRITE-side spelling is a SINGLE comma-joined string, not a JSON array.
 *
 * ⚠️ READ IS A THIRD SHAPE (OPNSENSE-2, distilled `homeflare/opnsense`'s `read-shape.ts`): the
 *   SAME list-shaped fields decode on GET as an option map `{key: {value, selected}}`, not a
 *   string — `AliasItem`/`GroupItem` (this family's OLD, pre-fix type references) were the
 *   WRITE-shaped structs; `fetchLive` actually decodes `ModelAliasReadItem`/
 *   `ModelIfgroupentryReadItem` (the WHOLE-MODEL GET's read-shaped item), whose `type`/
 *   `interface`/`proto`/`categories`/`members` are option maps. `selectedOf`/`selectedOneOf`
 *   below extract the selected key(s) back to the SAME plain-string/string[] shape `matches`
 *   already compares, so the rest of this family's logic (and `AliasAttributes`/
 *   `GroupAttributes`'s own field types) is unchanged.
 *
 * ⚠️ COMMA-LIST ORDER ROUND-TRIP IS NOT ASSUMED STABLE. OPNsense builds these from a PHP
 *   associative array, and nothing in the model XML promises the join order survives a
 *   save-then-read unchanged. Sorting and deduplicating both sides before comparing is what makes
 *   `matches` (alias-form.ts, group-form.ts) actually settle instead of reporting drift on a
 *   re-ordered list that changed nothing — the same reasoning `../proxmox/user-wire.ts`'s
 *   `groupSet` documents for PVE's `groups` field.
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

/** One entry of a GET-decoded option map — `{value: <label>, selected: 0|1}`, see this file's
 * module doc. Structural, not imported from the SDK: every generated `*Map` field shares this
 * exact shape (`OptionEntry` in each service module), and staying structural here avoids a
 * per-resource-file type import just for this. */
export interface OpnsenseOptionEntry {
  readonly value: string;
  readonly selected: number;
}

/**
 * The selected key(s) of a GET-decoded option map, normalised the same way `csvSet` normalises
 * the write-side comma string — sorted, deduplicated, empty-key filtered. Use for a
 * `Multiple="Y"` field (`AliasItem.proto`, `AliasItem.categories`, `GroupItem.members`); for a
 * single-select field use `selectedOneOf`.
 */
export const selectedOf = (
  map: Readonly<Record<string, OpnsenseOptionEntry | undefined>> | undefined,
): readonly string[] => {
  if (map === undefined) return [];
  const keys = Object.entries(map)
    .filter(([key, entry]) => key !== '' && entry?.selected === 1)
    .map(([key]) => key);
  return [...new Set(keys)].sort();
};

/** Single-select convenience over `selectedOf` — the one selected key, or `''` if none (the same
 * "absent" spelling a plain string field uses, e.g. `AliasItem.type`/`GroupItem`'s own
 * `.\InterfaceField` members when not `Multiple="Y"`). */
export const selectedOneOf = (
  map: Readonly<Record<string, OpnsenseOptionEntry | undefined>> | undefined,
): string => selectedOf(map)[0] ?? '';

/** The encode direction, for test fixtures: every listed key marked `selected: 1`, mirroring a
 * real OPNsense GET response (`{[key]: {value, selected: 1}}`) — so a fixture exercises the exact
 * decode path `selectedOf`/`selectedOneOf` handle, not the pre-fix plain-string shape. */
export const optionMap = (...keys: readonly string[]): Record<string, OpnsenseOptionEntry> =>
  Object.fromEntries(keys.map((key) => [key, { value: key, selected: 1 }]));
