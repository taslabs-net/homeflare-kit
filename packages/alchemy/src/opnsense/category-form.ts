/**
 * `Opnsense.Firewall.Category`'s wire shape: how a live `CategoryItem` becomes attributes, and
 * the comparison that decides whether a declaration already matches it. Mirrors alias-form.ts.
 */
import type { CategoryAttributes, CategoryProps } from './category.ts';
import type * as category from '@distilled.cloud/opnsense/firewall_category';
import { bool01 } from './wire.ts';

/** ★ Attributes and the declaration renderer are one function — see alias-form.ts's header note. */
export const attributesOf = (uuid: string, live: category.CategoryItem): CategoryAttributes => ({
  auto: bool01(live.auto, false),
  color: live.color ?? '',
  name: live.name,
  uuid,
});

export const matches = (attributes: CategoryAttributes, props: CategoryProps): boolean =>
  attributes.name === props.name &&
  attributes.auto === (props.auto ?? false) &&
  attributes.color === (props.color ?? '');
