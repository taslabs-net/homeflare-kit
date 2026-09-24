/**
 * `Opnsense.Firewall.Alias`'s wire shape: how a live `AliasItem` becomes attributes, and the
 * comparison that decides whether a declaration already matches it. Split out of alias.ts to
 * keep that file under the house's 250-line cap, mirroring `../proxmox/user-wire.ts`.
 *
 * ⛔ SCOPE, STATED ONCE. `AliasItem` (firewall_alias.ts) carries far more fields than this props
 *   type declares — three groups are left out on purpose:
 *     1. Runtime counters (`current_items`, `last_updated`, `eval_nomatch`, `eval_match`,
 *        `in_block_p`/`_b`, `in_pass_p`/`_b`, `out_block_p`/`_b`, `out_pass_p`/`_b`) — these are
 *        the alias's hit/block statistics, not configuration, exactly the "stats" the task that
 *        opened this family says to exclude.
 *     2. `path_expression` — only meaningful for the `urljson` alias type; a niche field this
 *        first import pass leaves for a later one rather than modelling one type's one field.
 *     3. `password`/`username`/`authtype`/`expire` — the URL-fetch credential fields for the
 *        `url`/`urltable`/`urljson` alias types. S25 (secrets stay out of props/attributes):
 *        `password` is a literal stored credential and Alchemy persists Attributes unencrypted,
 *        the same reasoning `../proxmox/user.ts` gives for shipping no `password` prop at all.
 */
import type { AliasAttributes, AliasProps } from './alias.ts';
import type * as alias from '@distilled.cloud/opnsense/firewall_alias';
import { bool01, csvSet, csvSetOf, numField } from './wire.ts';

/**
 * ★ ATTRIBUTES AND THE DECLARATION RENDERER ARE ONE FUNCTION. Attributes ARE exactly the props a
 *   noop declaration needs — see the exported `propsFromLive` alias in alias.ts's barrel and
 *   `alias-form.test.ts`'s round-trip test (`matches(attributesOf(uuid, live), attributesOf(uuid,
 *   live))` is always true by construction, and so is the general case).
 */
export const attributesOf = (uuid: string, live: alias.AliasItem): AliasAttributes => ({
  categories: csvSet(live.categories),
  content: live.content ?? '',
  counters: bool01(live.counters, false),
  description: live.description ?? '',
  enabled: bool01(live.enabled, true),
  interface: live.interface ?? '',
  name: live.name,
  proto: live.proto ?? '',
  type: live.type,
  updatefreq: numField(live.updatefreq, 0),
  uuid,
});

export const matches = (attributes: AliasAttributes, props: AliasProps): boolean =>
  attributes.name === props.name &&
  attributes.type === props.type &&
  attributes.enabled === (props.enabled ?? true) &&
  attributes.content === (props.content ?? '') &&
  attributes.interface === (props.interface ?? '') &&
  attributes.proto === (props.proto ?? '') &&
  attributes.counters === (props.counters ?? false) &&
  attributes.updatefreq === (props.updatefreq ?? 0) &&
  attributes.description === (props.description ?? '') &&
  attributes.categories.join(',') === csvSetOf(props.categories).join(',');
