/**
 * Reading a NetBox row into settled values.
 *
 * ⛔ A NETBOX READ AND A NETBOX WRITE ARE NOT THE SAME SHAPE, AND THIS IS WHERE THAT IS HANDLED.
 *   MEASURED in the 4.7.0 document: `WritablePrefixRequest.status` is a bare string enum
 *   (`"active"`), while `Prefix.status` on the way back is an OBJECT — `{value, label}`. A `diff`
 *   that compared the declared string against the live object would see drift on every plan, for
 *   every prefix, forever, and each "update" would PATCH the same value back.
 * ⚠️ The same asymmetry holds for every choice field in NetBox (`dcim` device `status`,
 *   `ipam` IP `role`, …). Anything read through `choice` is safe against it.
 */

/** ⚠️ `''` for absent, not `undefined` — NetBox stores an empty string, never null, for text. */
export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const bool = (value: unknown): boolean => value === true;

/** A `{value, label}` choice object, reduced to the string a declaration writes. */
export const choice = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return text((value as { value: unknown }).value);
  }
  return '';
};

/**
 * A foreign key, as the integer a declaration writes.
 *
 * ⚠️ IT ARRIVES AS A NESTED OBJECT ON READ AND AN INTEGER ON WRITE — `{id, url, display, …}`
 *   versus `4`. Comparing the two directly is the same never-converges bug as `choice`.
 */
export const fk = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id;
    return typeof id === 'number' ? id : undefined;
  }
  return undefined;
};
