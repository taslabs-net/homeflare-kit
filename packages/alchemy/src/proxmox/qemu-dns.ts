/** Cloud-init's one named format, checked against the vendor table and validator source. */
import { isIP } from 'node:net';
import { constraintsFor } from './constraint-guard.ts';

/**
 * PVE::JSONSchema pve_verify_address/check_format and PVE::ParseUtils split_list,
 * proxmox/pve-common@defd246f31f327463f901a2daaf8dc52efcc5a97 (read 2026-10-05).
 * https://github.com/proxmox/pve-common/blob/defd246f31f327463f901a2daaf8dc52efcc5a97/src/PVE/JSONSchema.pm
 * ★ `address` permits DNS names too; an IP-only check would reject vendor-valid declarations.
 * Empty lists are allowed. NUL-separated lists take precedence over whitespace/comma/semicolon.
 * This supplements the PVE 9.2.11 schema's named format; it does not invent a DNS-server limit.
 */
const addressList = (value: string): boolean => {
  const values = value.includes('\0')
    ? value.split('\0')
    : value.replace(/[,;]/g, ' ').trimStart().split(/\s+/);
  // Perl split drops trailing empty elements, but retains interior empty elements.
  while (values.at(-1) === '') values.pop();
  const label = '[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?';
  const dns = new RegExp(`^(?:${label}\\.)*${label}(?![\\s\\S])`);
  return values.every((value) => (isIP(value) !== 0 && !value.includes('%')) || dns.test(value));
};

export const dnsRefusals = (nameserver: unknown): string[] => {
  if (nameserver === undefined) return [];
  const rule = constraintsFor('pve:PUT /nodes/{node}/qemu/{vmid}/config')['nameserver'];
  return rule?.format === 'address-list' &&
    typeof nameserver === 'string' &&
    addressList(nameserver)
    ? []
    : ['nameserver: must satisfy the vendor address-list format'];
};
