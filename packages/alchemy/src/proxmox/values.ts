/**
 * How PVE spells a value on the wire, and how to get it back to something comparable.
 *
 * ⛔ EVERY FUNCTION HERE WAS FOUND IN TWO OR MORE RESOURCE FILES, AND THE COPIES HAD DRIFTED.
 *   `num` was byte-identical in three files, so merging it is free. The boolean was NOT: four
 *   files declared `const flag` and meant four different things by it, including one that ran the
 *   other way round. That is the whole reason this module exists — not to save lines, but because
 *   a name that means four things is a bug waiting for the person who assumes it means the first
 *   one they read.
 *
 * ★ THE TWO DIRECTIONS ARE NAMED APART, DELIBERATELY. `bool` reads the wire and answers a
 *   TypeScript boolean; `flag` writes a form field and answers PVE's `'1'`/`'0'`. `storage.ts`
 *   held both under one name — `flag` there was the write direction while `flag` in three other
 *   files was the read direction — which typechecks in both files and is exactly the confusion
 *   that survives review.
 *
 * ⚠️ NOTHING HERE IS RESOURCE-SPECIFIC. A coercion that only one PVE object needs belongs in that
 *   object's file, where its reasoning sits next to the field it serves. `role.ts` keeps its own
 *   `canonical` for the same reason: that one sorts a privilege SET, which is a different idea
 *   from `canonicalToken` below however similar the names read.
 */

/** ⚠️ `typeof value === 'number'` and not `Number(value)`: PVE sends `null` for an unset field. */
export const num = (value: unknown, fallback: number) =>
  typeof value === 'number' ? value : fallback;

export const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

/**
 * A PVE boolean off the wire.
 *
 * ⛔ THE FOUR SPELLINGS THIS REPLACES, AND WHY THIS ONE IS A SUPERSET OF ALL OF THEM. Measured in
 *   the files they came from: `backup-job` accepted `1 | true | '1'` with a caller's fallback;
 *   `sdn-vnet` the same three with no fallback; `storage` accepted only `1 | true`; `user` ran the
 *   value through `Number()` and asked `!== 0`. For the values PVE actually returns on these
 *   endpoints — `0` and `1` — all four agree, so accepting the union changes no live answer.
 *
 * ⚠️ THE ONE REAL DIFFERENCE IS `2`. `user.ts` would have read any non-zero number as true; this
 *   reads only `1`. No PVE field in this package is documented to return anything but 0 or 1, and
 *   a field that did would be a flag with more than two states — which is not a boolean, and
 *   should be read with `num` and named for what it is rather than quietly coerced here.
 *
 * ⚠️ `null`, `undefined` AND `''` ALL TAKE THE FALLBACK. An absent key means PVE's documented
 *   default for that field, which is not always `false` — so the default is the CALLER's to state,
 *   and `false` is only the fallback's own default for fields that really do default off.
 *
 * ⛔ THE EMPTY STRING IS ABSENT, NOT FALSE, AND GETTING THAT WRONG WRITES THE WRONG VALUE. A
 *   metric server is a SectionConfig section and can hand back `''` for an unset flag. Read as
 *   `false`, the two fields in this package that default ON — `backup-job.enabled` and
 *   `user.enable` — would come back disabled, `matches` would report an update nobody asked for,
 *   and the deploy would then WRITE `enabled=0` onto a live job. An empty string is not a
 *   boolean; it is the absence of one.
 */
export const bool = (value: unknown, fallback = false) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value === 1 || value === true || value === '1';

/**
 * A boolean on its way INTO a PVE form.
 *
 * ⚠️ `undefined` IN, `undefined` OUT — an undeclared field must not be sent at all. Sending `'0'`
 *   for a prop the caller never set would write PVE's default over whatever is live, turning an
 *   omission into an edit.
 */
export const flag = (value?: boolean) => (value === undefined ? undefined : value ? '1' : '0');

/**
 * A comma list PVE does not promise to give back in the order it was handed.
 *
 * ⚠️ `nodes` IS A SET AND PVE DOES NOT PRESERVE ITS ORDER. The zone plugin decodes the list into a
 *   hash and re-encodes it by joining that hash's keys, so the string you get back is not the one
 *   you sent. Sorting both sides is what stops a plan reporting an update because two names came
 *   back the other way round. `peers` gets the same treatment: it is a mesh, not a queue.
 */
export const csv = (value: readonly string[] | string | undefined) =>
  (typeof value === 'string' ? value.split(',') : (value ?? []))
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .sort()
    .join(',');

/**
 * A comma list of guest IDs, in numeric order.
 *
 * ⚠️ ORDER IS NOT MEANING IN A GUEST LIST, SO IT MUST NOT BE A DIFF. PVE stores `vmid` as the
 *   comma-separated string it was handed and gives it back the same way, so a declaration listing
 *   the same guests in another order would otherwise be an update that rewrites the job to say
 *   exactly what it already said. Both sides are sorted numerically before they meet.
 *
 * ⚠️ NUMERIC, NOT LEXICAL — this is why it is not `csv`. Sorted as text, `101` precedes `99`.
 */
export const guestList = (value: unknown): string => {
  const parts =
    typeof value === 'string'
      ? value.split(',')
      : Array.isArray(value)
        ? value.map((entry: unknown) => String(entry))
        : [];
  return parts
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isFinite(id))
    .sort((left, right) => left - right)
    .map((id) => String(id))
    .join(',');
};

/** `yes`/`true`/`on` and their opposites are the same value as 1/0 to PVE; make them one string. */
export const canonicalToken = (raw: string) => {
  const lowered = raw.trim().toLowerCase();
  if (['1', 'yes', 'true', 'on'].includes(lowered)) return '1';
  if (['0', 'no', 'false', 'off'].includes(lowered)) return '0';
  return lowered;
};

/**
 * A PVE property string, flattened to one comparable form.
 *
 * ⚠️ A PROPERTY STRING AND ITS PARSED FORM ARE ONE VALUE IN TWO SHAPES, AND PVE HANDS BACK
 *   WHICHEVER IT LIKES. MEASURED: `fleecing` is WRITTEN as the property string `fleecing=enabled=0`
 *   and READ BACK as the nested object {"enabled":0}. Comparing raw values would report an update
 *   on every plan for a job nobody touched — the same forever-diff a create-only field causes. So
 *   both sides are flattened here, sorted, and only then compared. `prune-backups` goes through
 *   the same funnel: same kind of value, the normalisation is free, and guessing which shape it
 *   comes back in is exactly the guess that costs a permanent diff.
 *
 * ⚠️ `defaultKey` EXISTS BECAUSE `fleecing=1` IS SHORTHAND FOR `fleecing=enabled=1`. PVE's format
 *   for it is written `[enabled=]<1|0>`, so a bare token is legal on write and comes back expanded
 *   on read; unexpanded, the short and long spellings never compare equal. `prune-backups` has no
 *   default key, so a bare token there is passed through as-is rather than invented into one.
 */
export const propertyString = (value: unknown, defaultKey?: string): string => {
  const pairs: [string, string][] =
    typeof value === 'string'
      ? value.split(',').map((part) => {
          const [key, ...rest] = part.split('=');
          return rest.length === 0 && defaultKey !== undefined
            ? [defaultKey, key ?? '']
            : [key ?? '', rest.join('=')];
        })
      : typeof value === 'object' && value !== null
        ? Object.entries(value).map(([key, entry]) => [key, String(entry)])
        : [];
  return pairs
    .map(([key, entry]) => [key.trim(), canonicalToken(entry)] as const)
    .filter(([key]) => key !== '')
    .map(([key, entry]) => `${key}=${entry}`)
    .sort()
    .join(',');
};

/**
 * An integer PVE may have spelled as a string.
 *
 * ⚠️ PVE MAY HAND BACK EITHER `8086` OR `"8086"`. These objects are SectionConfig sections, and the
 *   integer check VALIDATES the parsed string rather than converting it, so whether a number
 *   arrives as a number is a property of the version you are talking to. `'8086' === 8086` is
 *   false, and that is an update consisting of nothing, reported on every plan forever.
 */
export const int = (value: unknown, fallback: number) => {
  if (typeof value === 'number') return value;
  const parsed = Number.parseInt(text(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

/**
 * A PVE update form with its clear-list attached, and the two guaranteed not to overlap.
 *
 * ⛔ PVE DIES IF A KEY IS SET AND DELETED IN ONE CALL, AND SIX FAMILIES HERE BUILT THAT FORM BY
 *   HAND. Measured in the shipped Perl on n2 — `PVE::SectionConfig::delete_from_config`, line 1860:
 *
 *     die "cannot set and delete property '$k' at the same time!\n"
 *         if defined($new_options->{$k});
 *
 *   `defined` is the test, not truth, so `strict=0` or `comment=''` in the body counts as SET. The
 *   concrete failure: a live node-affinity rule with `strict 1` and a declaration carrying
 *   `strict: false`. `matches` reports an update; the clear-list has to name `strict`, because a
 *   PUT of `strict=0` merges a falsy value the plugin still stores; and if the body also emits
 *   `strict: '0'` the PUT is refused. The update never lands, the next plan reports the same
 *   update, and every deploy 500s — forever.
 *
 * ★ SO DISJOINTNESS IS ENFORCED HERE RATHER THAN REASONED ABOUT SIX TIMES. A cleared key is
 *   dropped from the body: CLEAR WINS. That is the right way round because a clear-list entry is
 *   computed from "this prop is absent, and absent means remove it", which is a deliberate
 *   statement, while the body's value for the same key is the coercion of that same absence —
 *   `flag(false)` is `'0'`, and `'0'` is exactly what must not be sent.
 *
 * ⚠️ UNDEFINED VALUES ARE DROPPED TOO, so a form builder may emit `undefined` for a field it does
 *   not set without the caller filtering first. `new URLSearchParams` would otherwise stringify it
 *   to the literal text "undefined".
 */
export const withClears = (
  fields: Record<string, string | undefined>,
  clear: readonly string[],
): Record<string, string> => {
  const cleared = new Set(clear);
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && !cleared.has(key)) kept[key] = value;
  }
  return cleared.size === 0 ? kept : { ...kept, delete: [...cleared].join(',') };
};
