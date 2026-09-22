/**
 * A notification matcher — the rule that routes a notification to its targets — as ONE shape
 * shared by PVE (`Proxmox.NotificationMatcher`) and PBS (`Pbs.NotificationMatcher`).
 *
 * ★ ONE FILE FOR BOTH PRODUCTS BECAUSE IT IS ONE IMPLEMENTATION. Both servers run the same Rust
 *   crate, `proxmox-notify` (matcher.rs), PVE through its Perl bindings; the schemas in
 *   generated/pve.ts and generated/pbs.ts carry the same nine fields, and the forms below are
 *   typed against BOTH, so a drift on either side fails `tsc` here rather than on a server.
 *
 * ⚠️ A MATCHER IS ITS WHOLE RULE, SO EVERY RULE FIELD IS COMPARED, DECLARED OR NOT. Most families
 *   here leave an undeclared field alone (backup-job.ts's trade). A matcher cannot: an undeclared
 *   `match-field` on a matcher that has one is a declaration claiming "route everything" over a
 *   server that routes one job type — and `invert-match` flips the meaning of every other line.
 *   So `match-*` default to empty, `mode` to `all`, `invert-match` and `disable` to false, all are
 *   compared, and a PUT sends all of them (an emptied list as `delete`). Only `comment` keeps the
 *   usual "undeclared is unmanaged" rule, because nothing routes on it.
 *   ★ THE COST IS THAT ADOPTING A MATCHER MEANS DECLARING IT AS IT IS. PBS ships `default-matcher`
 *     with `invert-match`, a `match-field` and a `match-severity` (measured on PBS 4.2, 2026-09-22),
 *     so adopting it as-is means writing those three down. A declaration that leaves them out
 *     plans an UPDATE, which is the plan telling the truth about what the deploy would do.
 */
import type {
  ClusterNotificationsMatchersNamePutParams,
  ClusterNotificationsMatchersPostParams,
} from './generated/pve.ts';
import type {
  ConfigNotificationsMatchersNamePutParams,
  ConfigNotificationsMatchersPostParams,
} from './generated/pbs.ts';
import { bool, text } from './values.ts';

/** Everything a matcher declares except where it lives — the resource files add `target`. */
export interface NotificationMatcherFields {
  /** The primary key, a safe id (2–32 chars on PBS). Changing it is a replace. */
  name: string;
  /**
   * ⛔ THE TARGETS, BY NAME, AND REQUIRED: a matcher that notifies nobody is a routing rule for
   *   silence. `[]` is still declarable, and clears the list.
   * ⚠️ `targets`, NOT THE SERVER'S `target`: every resource here already spends `target` on the
   *   HOST (resource.ts `WithTarget`), and one key cannot mean both. The wire still says `target`.
   */
  targets: readonly string[];
  /**
   * Severity rules. EACH ITEM IS ITSELF A COMMA LIST: `'warning,error'` matches either.
   * ⛔ `['warning', 'error']` IS NOT THE SAME RULE AND UNDER `mode: 'all'` NEVER MATCHES. Items are
   *   combined with `mode`; the severities inside one item are always OR-ed (matcher.rs
   *   `SeverityMatcher`). A notification has one severity, so two items under AND ask for a
   *   notification that is both — and routing nothing is the quietest failure a matcher has.
   * Severities: `info`, `notice`, `warning`, `error`, `unknown`.
   */
  'match-severity'?: readonly string[];
  /**
   * Metadata rules, `exact:<field>=<v1>,<v2>` or `regex:<field>=<re>`. ⚠️ THE PREFIX IS REQUIRED:
   * the schema's pattern makes it optional and the parser then refuses it. A notification WITHOUT
   * the field never matches its rule — so `exact:job-id=…` excludes every garbage collection.
   */
  'match-field'?: readonly string[];
  /** Time windows, e.g. `mon-fri 9:00-17:00`. Compared as written; the server keeps the text. */
  'match-calendar'?: readonly string[];
  /** How the rule items combine. The server's default, and this package's, is `all`. */
  mode?: 'all' | 'any';
  /** Invert the whole rule. ⚠️ IGNORED WHEN THERE ARE NO RULES — an empty matcher always matches. */
  'invert-match'?: boolean;
  /** A disabled matcher routes nothing. */
  disable?: boolean;
  /** Free text. The one field left alone when undeclared; `''` clears it. */
  comment?: string;
}

/** ⚠️ Lists are CANONICAL and SORTED, so a re-ordered declaration is not a diff. */
export interface NotificationMatcherAttributes {
  name: string;
  /**
   * `builtin`, `modified-builtin` or `user-created`. REPORTED, NEVER COMPARED.
   * ⛔ ON A BUILT-IN A DELETE REVERTS RATHER THAN REMOVES, and reports success either way — Alchemy
   *   drops the row while `default-matcher` goes on routing. Read this before destroying one.
   * ★ MEASURED ON THE PER-OBJECT READ, which the published schema does not list: PVE 9.2.11 and
   *   PBS 4.2 both return it from `…/matchers/default-matcher` (2026-09-22).
   */
  origin: string;
  comment: string;
  disable: boolean;
  'invert-match': boolean;
  mode: string;
  targets: readonly string[];
  'match-severity': readonly string[];
  'match-field': readonly string[];
  'match-calendar': readonly string[];
}

const list = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.map((item: unknown) => String(item)) : [];

/** Trimmed items, empty ones dropped. */
const items = (values: readonly string[], canonical: (item: string) => string): string[] =>
  values.map((item) => canonical(item.trim())).filter((item) => item !== '');

/**
 * ⚠️ THE SERVER WRITES A RULE BACK IN ITS OWN SPELLING, SO BOTH SIDES ARE SPELLED ITS WAY FIRST.
 *   matcher.rs parses `exact:type=gc, verify` into values and `Display`s them joined by a bare
 *   comma; a severity item is split, trimmed and re-joined the same way. Without this a
 *   declaration with a space after a comma would plan an update forever.
 */
const severity = (item: string): string =>
  item
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .sort()
    .join(',');

const field = (item: string): string => {
  if (!item.startsWith('exact:')) return item;
  const at = item.indexOf('=');
  if (at < 0) return item;
  const values = item.slice(at + 1).split(',');
  return `${item.slice(0, at)}=${values.map((value) => value.trim()).join(',')}`;
};

const same = (item: string): string => item;

/** A declaration's lists, canonical and sorted — the form `matches` compares. */
export const canonicalRules = (fields: NotificationMatcherFields) => ({
  'match-calendar': items(fields['match-calendar'] ?? [], same).sort(),
  'match-field': items(fields['match-field'] ?? [], field).sort(),
  'match-severity': items(fields['match-severity'] ?? [], severity).sort(),
  targets: items(fields.targets, same).sort(),
});

export const matcherAttributes = (
  live: Record<string, unknown>,
  name: string,
): NotificationMatcherAttributes => ({
  comment: text(live['comment']),
  disable: bool(live['disable']),
  'invert-match': bool(live['invert-match']),
  'match-calendar': items(list(live['match-calendar']), same).sort(),
  'match-field': items(list(live['match-field']), field).sort(),
  'match-severity': items(list(live['match-severity']), severity).sort(),
  // ⚠️ ABSENT IS `all` — matcher.rs `mode.unwrap_or_default()`, and `All` is the default variant.
  mode: text(live['mode'], 'all') || 'all',
  name,
  origin: text(live['origin']),
  targets: items(list(live['target']), same).sort(),
});

const equal = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

export const matcherMatches = (
  attributes: NotificationMatcherAttributes,
  fields: NotificationMatcherFields,
): boolean => {
  const rules = canonicalRules(fields);
  return (
    attributes.disable === (fields.disable === true) &&
    attributes['invert-match'] === (fields['invert-match'] === true) &&
    attributes.mode === (fields.mode ?? 'all') &&
    equal(attributes.targets, rules.targets) &&
    equal(attributes['match-severity'], rules['match-severity']) &&
    equal(attributes['match-field'], rules['match-field']) &&
    equal(attributes['match-calendar'], rules['match-calendar']) &&
    (fields.comment === undefined || attributes.comment === fields.comment)
  );
};

type Deletable = NonNullable<ConfigNotificationsMatchersNamePutParams['delete']>[number];
type Lists = 'match-calendar' | 'match-field' | 'match-severity' | 'target';

/**
 * The fields both forms send. ⚠️ LISTS GO AS ARRAYS — REPEATED KEYS ON THE WIRE (client.ts
 * `encode`) — because every list here is `type: array` on both servers, and a comma inside a
 * severity item or an `exact:` rule means a comma-joined string could not carry them anyway.
 */
const always = (fields: NotificationMatcherFields) => ({
  disable: fields.disable === true ? ('1' as const) : ('0' as const),
  'invert-match': fields['invert-match'] === true ? ('1' as const) : ('0' as const),
  mode: fields.mode ?? ('all' as const),
});

const lists = (fields: NotificationMatcherFields): Partial<Record<Lists, readonly string[]>> => {
  const rules = canonicalRules(fields);
  const out: Partial<Record<Lists, readonly string[]>> = {};
  if (rules['match-calendar'].length > 0) out['match-calendar'] = rules['match-calendar'];
  if (rules['match-field'].length > 0) out['match-field'] = rules['match-field'];
  if (rules['match-severity'].length > 0) out['match-severity'] = rules['match-severity'];
  if (rules.targets.length > 0) out.target = rules.targets;
  return out;
};

export type MatcherCreateForm = ConfigNotificationsMatchersPostParams &
  ClusterNotificationsMatchersPostParams;
export type MatcherUpdateForm = ConfigNotificationsMatchersNamePutParams &
  ClusterNotificationsMatchersNamePutParams;

/** ⛔ `name` is create-only: the body carries it once and the path forever after. */
export const matcherCreateForm = (fields: NotificationMatcherFields): MatcherCreateForm => ({
  ...always(fields),
  ...lists(fields),
  ...(fields.comment === undefined || fields.comment === '' ? {} : { comment: fields.comment }),
  name: fields.name,
});

/**
 * ⛔ AN EMPTIED LIST IS A `delete`, NOT AN EMPTY VALUE. A form cannot carry an empty array — no
 *   key is sent at all — so without the `delete` entry a declaration of `'match-field': []`
 *   would plan an update, PUT nothing for that field, and plan the same update forever.
 */
export const matcherUpdateForm = (fields: NotificationMatcherFields): MatcherUpdateForm => {
  const present = lists(fields);
  const cleared: Deletable[] = (
    ['match-calendar', 'match-field', 'match-severity', 'target'] as const
  ).filter((key) => present[key] === undefined);
  if (fields.comment === '') cleared.push('comment');
  return {
    ...always(fields),
    ...present,
    ...(fields.comment === undefined || fields.comment === '' ? {} : { comment: fields.comment }),
    ...(cleared.length === 0 ? {} : { delete: cleared }),
  };
};
