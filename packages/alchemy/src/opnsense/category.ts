/**
 * `Opnsense.Firewall.Category` — a read-only declaration of one `firewall/category` item (the
 * tag OPNsense's UI groups aliases, rules etc. by) on the edge. READ-ONLY BY DESIGN — see
 * policy.ts's header. `reconcile`/`delete` always refuse. Mirrors alias.ts exactly; see that
 * file's header for why `get()` (whole model) is the read source rather than `getCategory` —
 * the same generation gap (no `uuid` in `GetCategoryRequest`'s schema) applies here too.
 */
import { adopt } from 'alchemy/AdoptPolicy';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Category from '@distilled.cloud/opnsense/firewall_category';
import type { OpnsenseOpError } from '@distilled.cloud/opnsense/Protocol';
import * as Effect from 'effect/Effect';
import { attributesOf, matches } from './category-form.ts';
import type { OpnsenseRequirements, OpnsenseSpec } from './resource.ts';
import { opnsenseHandlers } from './resource.ts';

export interface CategoryProps {
  readonly uuid: string;
  /** Pattern `/[^,]+/` on the wire — a comma in the name would collide with the multi-select join. */
  readonly name: string;
  /** Whether OPNsense itself created this category (its own subsystems tag things this way); a
   * category a person made is `false`/absent. */
  readonly auto?: boolean;
  /** Six hex digits, no `#`, e.g. `0000FF`. */
  readonly color?: string;
}

export interface CategoryAttributes {
  readonly uuid: string;
  readonly name: string;
  readonly auto: boolean;
  readonly color: string;
}

export interface OpnsenseFirewallCategory extends Resource<
  'Opnsense.Firewall.Category',
  CategoryProps,
  CategoryAttributes,
  never,
  OpnsenseRequirements
> {}

export const OpnsenseFirewallCategory = Resource<OpnsenseFirewallCategory>(
  'Opnsense.Firewall.Category',
  {
    defaultRemovalPolicy: 'retain',
  },
);

export const isOpnsenseFirewallCategory = (value: unknown): value is OpnsenseFirewallCategory =>
  typeof value === 'object' &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Opnsense.Firewall.Category';

export const spec: OpnsenseSpec<
  CategoryProps,
  Category.CategoryItem,
  CategoryAttributes,
  OpnsenseOpError
> = {
  attributes: attributesOf,
  fetchLive: (props) =>
    Category.get({}).pipe(Effect.map((res) => res.category?.categories?.category?.[props.uuid])),
  matches,
  resourceType: 'Opnsense.Firewall.Category',
};

/** The pure declaration renderer — see alias.ts's `propsFromLive` for the full contract note. */
export const propsFromLive = attributesOf;

export const handlers = opnsenseHandlers(spec);

export const OpnsenseFirewallCategoryProvider = () =>
  Provider.effect(
    OpnsenseFirewallCategory,
    Effect.succeed(OpnsenseFirewallCategory.Provider.of(handlers)),
  );

/** `firewallCategory('name', { uuid, name })` — `adopt(true)` piped by default (H5). */
export const firewallCategory = (id: string, props: CategoryProps) =>
  OpnsenseFirewallCategory(id, props).pipe(adopt(true));
