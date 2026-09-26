/**
 * B6: the field-level drift framework every family's own `driftOf(live, props)` is built on
 * (`network-form.ts`, `firewall-zone-form.ts`, and whatever family follows). Consumed by
 * `homeflare-network`'s pre-import drift check (its own C4, not built here) to show WHICH fields
 * a live object and a committed declaration disagree on, before that script overwrites the
 * committed module — never by a `Unifi.*` provider itself, which only ever needs `matches`'s
 * boolean.
 *
 * ★ BUILT ON `matches`, NOT A SEPARATE COMPARISON. Each family's `driftOf` reuses the SAME
 *   normalizers (`sortedSet`, the `dhcpGuarding`/`ipv6Configuration` null-vs-undefined handling)
 *   its own `matches` already applies — so this reports NOTHING `matches` would call a noop, and
 *   everything `matches` would call `update`, broken down by field instead of collapsed to one
 *   boolean. Two comparisons drifting apart would be its own bug class; there is exactly one.
 */
import { deepEqual } from 'alchemy/Diff';

/** One field whose live and declared values differ, as `makeDriftOf` reports it. */
export interface FieldDrift {
  readonly field: string;
  readonly live: unknown;
  readonly declared: unknown;
}

/** One field's comparison recipe for `makeDriftOf`. */
export interface DriftField<Attributes, Props> {
  readonly field: string;
  readonly live: (attributes: Attributes) => unknown;
  readonly declared: (props: Props) => unknown;
  /**
   * Defaults to `alchemy/Diff`'s `deepEqual` with `stripNullish: true` — the same tolerance
   * every `matches` in this directory already gives UniFi's `null`-for-unset optionals (see
   * `network-form.ts`'s header). Pass one explicitly for a field `matches` compares as a
   * normalized SET (`firewall-zone-form.ts`'s `networkIds`), where plain `deepEqual` would
   * report order as drift `matches` never would.
   */
  readonly equal?: (live: unknown, declared: unknown) => boolean;
}

const defaultEqual = (live: unknown, declared: unknown) =>
  deepEqual(live, declared, { stripNullish: true });

/**
 * Builds a `(attributes, props) => FieldDrift[]` from a field list — the framework a family's own
 * `*-form.ts` calls once, then wraps as `driftOf(live, props)` by feeding it `attributesOf(live,
 * props)` (the task's own API: callers have a live SDK object, not `Attributes`, on hand).
 */
export const makeDriftOf =
  <Attributes, Props>(fields: readonly DriftField<Attributes, Props>[]) =>
  (attributes: Attributes, props: Props): FieldDrift[] =>
    fields.flatMap(({ field, live, declared, equal = defaultEqual }) => {
      const liveValue = live(attributes);
      const declaredValue = declared(props);
      return equal(liveValue, declaredValue)
        ? []
        : [{ field, live: liveValue, declared: declaredValue }];
    });
