/** Existing alias normalization and forms, independent of the named SDK transport. */
import type { FirewallAliasAttributes, FirewallAliasProps } from './firewall-alias.ts';
import type { PveSpec } from './resource-spec.ts';
import { body, cidr, comment } from './firewall-alias-form.ts';
import { int, text } from './values.ts';

export const firewallAliasSpec = {
  /** The SDK read refuses malformed successful payloads before applying these normalizers. */
  attributes: (live, props) => {
    const address = cidr(live['cidr']);
    return {
      cidr: address,
      comment: comment(live['comment']),
      ipversion: int(live['ipversion'], 0),
      /** The read checks identity; the stored spelling is preserved for display. */
      name: text(live['name'], props.name),
    };
  },
  collection: () => 'cluster/firewall/aliases',
  createForm: (props) => ({ ...body(props), name: props.name }),
  /**
   * ⚠️ EXACTLY THE TWO FIELDS A PUT CAN PUT BACK, both sides through the same normalisers. `name`
   *   is identity and case-only drift (see the header); `ipversion` is derived and unwritable.
   *   Comparing either would report an update that no update can settle.
   */
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: {
    create: 'pve:POST /cluster/firewall/aliases',
    update: 'pve:PUT /cluster/firewall/aliases/{name}',
  },
  matches: (attributes, props) =>
    attributes.cidr === cidr(props.cidr) && attributes.comment === comment(props.comment),
  /**
   * ⚠️ UNESCAPED ON PURPOSE: `pve-fw-alias` admits only `[A-Za-z][A-Za-z0-9\-\_]+`, so there is no
   *   character here that a URL would need to encode, and PVE lowercases the segment on arrival.
   */
  path: (props) => `cluster/firewall/aliases/${props.name}`,
  updateForm: body,
} satisfies PveSpec<FirewallAliasProps, FirewallAliasAttributes>;
