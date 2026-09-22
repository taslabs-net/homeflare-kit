/**
 * The two rule kinds the first generation silently dropped, and the measurement behind each.
 *
 * 🔴 BOTH ARE THE SAME FAILURE AS THE 128-CHARACTER COMMENT: a limit the vendor publishes, that
 *   nothing local enforces, so the refusal arrives from the server half a deploy in. Neither shows
 *   up as a missing table — the table is there, the row is there, and the rule is simply absent.
 *
 * ⛔ 1. PVE ANCHORS EVERY PATTERN AND THE TABLE DID NOT. MEASURED 2026-09-22, read-only on a
 *   cluster node, `/usr/share/perl5/PVE/JSONSchema.pm:1636`:
 *
 *       if (my $pattern = $schema->{pattern}) {
 *           if ($value !~ m/^$pattern$/) {
 *
 *   The published pattern is the INSIDE of an anchored match. PVE ships it unanchored — `cidr`,
 *   `starttime`, a firewall alias `name` of `[A-Za-z][A-Za-z0-9\-\_]+` — and `RegExp.test` is a
 *   SEARCH, so `'ok name!'` matched on the `ok` and passed a plan PVE then rejected with 400.
 *   Every one of the six PVE patterns in the tables was toothless this way.
 *   ★ THE ANCHORING IS TEXTUAL, NOT GROUPED, because Perl's is: `m/^$pattern$/` on `a|b` is
 *     `^a|b$`, which is `(^a)|(b$)` and NOT `^(?:a|b)$`. Three PVE patterns have a top-level `|`
 *     (measured over all 72), so wrapping in `(?:…)` would ENFORCE A RULE PVE DOES NOT HAVE.
 *   ★ `\n?` BEFORE THE `$` IS PERL'S `$`, NOT A COURTESY. Perl's `$` matches at the end or just
 *     before a final newline; JavaScript's matches only at the end. Without it a value ending in a
 *     newline would be refused here and accepted by PVE — the false positive that is worse than
 *     the 400 this replaces.
 *   ⚠️ PBS IS LEFT ALONE. Its patterns arrive already carrying `^…$` (all 37, measured) and Rust's
 *     `Regex::is_match` is a search, so anchoring them again would be inventing a rule.
 *
 * ⛔ 2. AN ARRAY'S RULES LIVE ON `items`, AND THE EMITTER ONLY READ THE PARAMETER. 30 parameters
 *   across the tabled endpoints are `type: array`, and several carry real limits one level down —
 *   PBS `target` (maxLength 32, minLength 2, a name pattern), PBS `associated-key`, PVE
 *   `secondary-controllers` (maxLength 64). The validator already checks EVERY element of an array
 *   value against the row, so the machinery was there and was being handed an empty rule.
 *   ⚠️ `required` IS NEVER TAKEN FROM `items`. Presence is about the parameter, not its elements.
 */
import type { VendorParam } from './apidoc.ts';
import { type TranslatedPattern, translatePattern } from './pattern.ts';
import { translateDjangoPattern } from './py-pattern.ts';

export type Product = 'pve' | 'pbs' | 'netbox';

export interface PatternRule {
  readonly pattern?: string;
  readonly patternFlags?: string;
  readonly patternSource?: string;
}

/**
 * Everything about a pattern that is TRUE OF ONE VENDOR, in one table.
 *
 * ★ A TABLE RATHER THAN A STRING EVERY FUNCTION SWITCHES ON. There are exactly two vendor facts —
 *   which dialect the regex is written in, and whether the vendor anchors it — and keeping them
 *   together is what stops a third product being added with one of the two forgotten. The
 *   forgotten one would not fail: it would silently enforce the wrong rule.
 *
 * ⛔ NETBOX GETS A DIFFERENT TRANSLATOR, NOT A SHARED ONE. `pattern.ts` is a whitelist for
 *   Rust/Perl spellings; NetBox ships Python regexes whose `\w` is Unicode where JavaScript's is
 *   ASCII. One whitelist covering both would have to accept every construct either vendor uses,
 *   which is precisely how a rule gets carried over wrongly for the other (codegen/py-pattern.ts).
 * ⛔ AND NETBOX DOES NOT ANCHOR. Django's `RegexValidator` uses `re.search` and NetBox's own
 *   patterns already carry `^…$` — all 7, measured over the whole 4.7.0 document — so anchoring
 *   them again would be inventing a rule, exactly as it would be for PBS.
 */
interface Dialect {
  readonly translate: (source: string) => TranslatedPattern;
  /** ⚠️ PVE only: it matches `m/^$pattern$/`, so the published pattern is the INSIDE of that. */
  readonly anchor: boolean;
}

const DIALECT: Readonly<Record<Product, Dialect>> = {
  netbox: { anchor: false, translate: translateDjangoPattern },
  pbs: { anchor: false, translate: translatePattern },
  pve: { anchor: true, translate: translatePattern },
};

/**
 * The vendor's spelling, always; a JavaScript-safe equivalent when one exists.
 *
 * ⛔ `patternFlags` IS EMITTED RATHER THAN DISCARDED. `translatePattern` lifts PBS's leading
 *   `(?m)` to a flag, and the first generation returned that flag and then threw it away — so a
 *   multi-line rule would have been enforced with single-line semantics, refusing values PBS
 *   accepts. No tabled endpoint uses one today; this is the guard for the day one does.
 */
export const patternRule = (source: string | undefined, product: Product): PatternRule => {
  if (source === undefined) return {};
  const dialect = DIALECT[product];
  const translated = dialect.translate(source);
  if (translated.js === undefined) return { patternSource: source };
  const js = dialect.anchor ? `^${translated.js}\\n?$` : translated.js;
  return {
    pattern: js,
    patternSource: source,
    ...(translated.flags === '' ? {} : { patternFlags: translated.flags }),
  };
};

const isParam = (value: unknown): value is VendorParam =>
  typeof value === 'object' && value !== null;

/**
 * A parameter merged with its element schema, so one row describes what each value must satisfy.
 *
 * ⚠️ THE PARAMETER WINS ON EVERY KEY IT STATES. A vendor that bounded both levels means both, and
 *   the element bound is the one that survives here only because the parameter left it unset.
 */
export const withItemRules = (param: VendorParam): VendorParam => {
  const items = (param as { readonly items?: unknown }).items;
  if (param.type !== 'array' || !isParam(items)) return param;
  return { ...items, ...param, type: param.type };
};

/** True when the row's value rules describe each ELEMENT of a repeated key, not one string. */
export const isElementRule = (param: VendorParam): boolean =>
  param.type === 'array' && isParam((param as { readonly items?: unknown }).items);
