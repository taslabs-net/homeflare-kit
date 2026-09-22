/**
 * A notification target's props, as the form PVE wants — including the one field in this package
 * that cannot be spelled as a comma list.
 *
 * ★ SPLIT OUT OF notification-target.ts TO KEEP BOTH UNDER THE 250-LINE CAP. The seam is the same
 *   one metric-server uses: this file turns a declaration into a form, and the resource file says
 *   what a target IS and when it has changed. The `import type` back is erased, so it is a cycle
 *   on paper only.
 */
import type { NotificationTargetProps } from './notification-target.ts';
import { text } from './values.ts';

/**
 * ⛔ A MULTI-VALUED PARAMETER GOES ON THE WIRE DIFFERENTLY HERE THAN ANYWHERE ELSE IN THIS PACKAGE,
 *   AND THE DIFFERENCE IS MEASURED. Every other PVE endpoint spells a list `type: string, format:
 *   pve-configid-list` — comma-joined, which is what sdn-vnet.ts sends. On the notification
 *   endpoints `mailto`, `mailto-user`, `header` and `delete` are `type: array`, and PVE's own web
 *   UI submits those as REPEATED KEYS (`header=a&header=b`). `Record<string, string>` cannot repeat
 *   a key, so one value carrying a NUL goes instead: it percent-encodes to `%00`, and PVE's
 *   urlencoded decoder joins repeated keys with exactly that byte, rebuilding the same parameter.
 *   ⚠️ ONLY `header` NEEDS IT, and only past one entry. A header item is ITSELF the property string
 *     `name=<name>,value=<base64>`, so a comma cannot express even one of them. Addresses hold no
 *     commas and PVE's UI submits `mailto` as a comma-separated text field, so those go that way.
 *   ⚠️ REASONED FROM THE DECODER AND THE UI, NOT PROVEN BY A LIVE MULTI-HEADER WRITE. One header
 *     carries no separator and is unaffected either way; a longer list, if rejected, fails with a
 *     400 naming `header` rather than quietly dropping one, and the fix is one line here.
 */
const REPEATED_KEY = '\0';

/** ⚠️ `0` is "PVE holds no port". Integers have come back as strings elsewhere, so parse both. */
export const portOf = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sorted = (parts: readonly string[]): string =>
  parts
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .sort()
    .join(',');

/**
 * ⚠️ ORDER IS NOT MEANING IN A RECIPIENT LIST, SO IT MUST NOT BE A DIFF — backup-job.ts's reasoning
 *   about guest ids, applied to addresses. Both sides are sorted before they meet.
 *
 * ⚠️ PVE ANSWERS WITH AN ARRAY AND ACCEPTS A DELIMITED STRING, and this package has already been
 *   bitten by a list coming back flattened on one version and structured on another (`groups` in
 *   user.ts). PVE's UI calls `mailto` "separated by spaces, commas or semicolons", so all three are
 *   split here and both shapes funnel into one comparable value.
 */
export const addressList = (value: unknown): string =>
  sorted(
    Array.isArray(value)
      ? value.map((item: unknown) => String(item))
      : typeof value === 'string'
        ? value.split(/[\s,;]+/)
        : [],
  );

/** ⛔ NEVER SPLIT ON A COMMA: a header item contains one. A lone string is one item, not a list. */
export const headerList = (value: unknown): string =>
  sorted(Array.isArray(value) ? value.map((item: unknown) => String(item)) : [text(value)]);

const set = (key: string, value: string | undefined): Record<string, string> =>
  value === undefined ? {} : { [key]: value };

/**
 * The form for both create and update.
 *
 * ⛔ A FIELD THE DECLARATION LEAVES OUT IS NOT SENT AND NOT COMPARED — backup-job.ts's rule rather
 *   than sdn-vnet.ts's `delete` list, and here the choice is not close. That list would have to
 *   name `mailto`, so a target adopted from the UI and declared without its recipients would have
 *   them stripped on the first deploy: the one object that makes failures visible, turned back into
 *   silence. `delete` on this family is also `type: array` rather than the comma string every other
 *   endpoint takes, so sdn-vnet's encoding would not even carry.
 *   ⚠️ THE PRICE IS THAT REMOVING A LINE DOES NOT CLEAR A FIELD. Declare it as `''` to clear it,
 *     which IS sent: an empty string is a value, an absent prop is no request at all.
 *
 * ⚠️ `disable` IS ALWAYS SENT AND ALWAYS COMPARED, `0` INCLUDED. PVE documents the default as 0, so
 *   sending it explicitly is what makes "not declared" and "declared false" one state instead of a
 *   plan that asks for an update the PUT never performs. It is also the drift that matters most
 *   here: a target disabled by hand during a maintenance window and never re-enabled looks exactly
 *   like a healthy cluster.
 */
export const shape = (props: NotificationTargetProps): Record<string, string> => ({
  disable: props.disable === true ? '1' : '0',
  ...set('author', props.author),
  ...set('body', props.body),
  ...set('comment', props.comment),
  ...set('from-address', props['from-address']),
  ...set('header', props.header === undefined ? undefined : props.header.join(REPEATED_KEY)),
  ...set('mailto', props.mailto === undefined ? undefined : addressList(props.mailto)),
  ...set(
    'mailto-user',
    props['mailto-user'] === undefined ? undefined : addressList(props['mailto-user']),
  ),
  ...set('method', props.method),
  ...set('mode', props.mode),
  ...set('port', props.port === undefined ? undefined : String(props.port)),
  ...set('server', props.server),
  ...set('url', props.url),
  ...set('username', props.username),
});

/**
 * The create form: `shape` plus the name PVE takes in the body exactly once.
 *
 * ★ EXPORTED SO THE CONSTRAINT PROOF CAN RUN THE REAL FORM rather than a retyped copy of it.
 * ⛔ `name` IS CREATE-ONLY: PVE takes it in the body on the POST and in the path forever after.
 */
export const createShape = (props: NotificationTargetProps): Record<string, string> => ({
  ...shape(props),
  name: props.name,
});
