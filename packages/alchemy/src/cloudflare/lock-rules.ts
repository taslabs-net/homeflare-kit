/**
 * The vocabulary of an R2 lock rule, and the comparison that decides whether to write one.
 *
 * ★ ITS OWN MODULE FOR THE REASON `<estate>/litellm/src/equal.ts` IS ONE: the comparison is the
 *   riskiest function in the provider and it deserves to be readable and testable without the
 *   lifecycle around it. An equality that returned true for everything would make every reconcile
 *   a no-op and the resource would silently never write anything — which looks exactly like a
 *   converged stack.
 */
/** Jurisdictions the API accepts, as the SDK declares them. */
export type Jurisdiction = 'default' | 'eu' | 'fedramp';

/**
 * One lock rule. ⚠️ `prefix` OMITTED MEANS THE WHOLE BUCKET — the SDK documents an empty prefix as
 * the way to scope a rule to every object, and omitting the key is how that is spelled on the wire.
 */
export type R2LockRule = {
  readonly id: string;
  readonly enabled: boolean;
  readonly prefix?: string;
  readonly condition:
    | { readonly type: 'Age'; readonly maxAgeSeconds: number }
    | { readonly type: 'Date'; readonly date: string }
    | { readonly type: 'Indefinite' };
};

/** ⚠️ `undefined` and `'default'` are the same jurisdiction; normalise so a diff never sees both. */
export const jurisdictionOf = (props: { readonly jurisdiction?: Jurisdiction }): Jurisdiction =>
  props.jurisdiction ?? 'default';

/**
 * ⛔ FIELD BY FIELD, IN ORDER, AND NOT `JSON.stringify` OF EITHER SIDE. The API returns rules in
 *   its own key order and omits `prefix` where this repo may spell it `''`; a stringify compare
 *   would report drift on every plan and PUT an identical body each deploy. Order across the list
 *   IS compared, because the rule set is a replace and the list is what gets sent.
 */
export function rulesEqual(a: readonly R2LockRule[], b: readonly R2LockRule[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    if (right === undefined) return false;
    if (left.id !== right.id || left.enabled !== right.enabled) return false;
    if ((left.prefix ?? '') !== (right.prefix ?? '')) return false;
    const [lc, rc] = [left.condition, right.condition];
    if (lc.type !== rc.type) return false;
    if (lc.type === 'Age') return rc.type === 'Age' && lc.maxAgeSeconds === rc.maxAgeSeconds;
    if (lc.type === 'Date') return rc.type === 'Date' && lc.date === rc.date;
    return true;
  });
}

/**
 * The body the SDK sends. Split out so the test can assert the wire shape against one function.
 *
 * ⚠️ IT TAKES THE RULES, NOT THE PROPS, so this module names nothing from the resource — the
 *   comparison and the vocabulary stay readable without the lifecycle around them.
 */
export const toBody = (rules: readonly R2LockRule[]): { rules: R2LockRule[] } => ({
  rules: rules.map((rule) => ({ ...rule })),
});
