/**
 * Wire coercions shared across Google Workspace resources.
 *
 * ⚠️ EVERY FIELD ON A GENERATED DIRECTORY TYPE IS `S.optional(...)` (the SDK does not know which
 *   fields Google always sends), so a live read is `string | undefined` even for a field the API
 *   guarantees in practice. These helpers turn that into the settled value a `matches()` compares
 *   against, mirroring `../netbox/values.ts` and `../forgejo/values.ts` for the same reason: a
 *   `diff` that compared `undefined` against a declared default would see drift forever.
 */

/** `''` for absent — Directory objects that omit a text field mean "no value", not `undefined`. */
export const text = (value: string | undefined): string => value ?? '';

export const bool = (value: boolean | undefined): boolean => value === true;

/**
 * Wire arrays compared in sorted order. `StringList` (group aliases, org unit paths in a search)
 * decodes to `string[] | undefined`; Directory does not promise an order.
 */
export const stringArray = (value: readonly string[] | undefined): string[] =>
  value === undefined ? [] : [...value].toSorted();

/**
 * Every user- and group-facing key in this family is case-insensitive on the wire (Google lower-
 * cases email addresses and org unit path segments internally) but a declaration may be typed in
 * mixed case. Compare through this, never with `===`, or an adopted object drifts on every plan.
 */
export const ciEqual = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

/** An org unit path as the API wants it for a path segment: no leading `/`. */
export const stripLeadingSlash = (path: string): string => path.replace(/^\/+/, '');

/** An org unit path as attributes should read it back: exactly one leading `/`. */
export const withLeadingSlash = (path: string): string =>
  path.startsWith('/') ? path : `/${path}`;
