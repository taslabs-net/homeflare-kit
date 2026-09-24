/**
 * `Opnsense.Firewall.Group`'s wire shape: how a live `GroupItem` (an interface group) becomes
 * attributes, and the comparison that decides whether a declaration already matches it. Mirrors
 * alias-form.ts.
 */
import type { GroupAttributes, GroupProps } from './group.ts';
import type * as group from '@distilled.cloud/opnsense/firewall_group';
import { bool01, csvSet, csvSetOf, numField } from './wire.ts';

/** ★ Attributes and the declaration renderer are one function — see alias-form.ts's header note. */
export const attributesOf = (uuid: string, live: group.GroupItem): GroupAttributes => ({
  description: live.descr ?? '',
  ifname: live.ifname,
  members: csvSet(live.members),
  nogroup: bool01(live.nogroup, false),
  sequence: numField(live.sequence, 0),
  uuid,
});

export const matches = (attributes: GroupAttributes, props: GroupProps): boolean =>
  attributes.ifname === props.ifname &&
  attributes.nogroup === (props.nogroup ?? false) &&
  attributes.sequence === (props.sequence ?? 0) &&
  attributes.description === (props.description ?? '') &&
  attributes.members.join(',') === csvSetOf(props.members).join(',');
