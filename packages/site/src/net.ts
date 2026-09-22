/**
 * IPv4 arithmetic for leg addresses: a network's base plus a host number.
 *
 * ★ WHY A HOST NUMBER AND NOT A LAST OCTET. On a /24 they are the same thing, and that is
 *   the common case. On a /23 or a /16 a "last octet" is ambiguous, while "the 11th
 *   address after the network address" is not. The /24 reading stays exact.
 */
import { parseCidr } from './primitives.ts';

function dotted(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

/** The largest usable host number on a network (the broadcast address is excluded). */
export function lastHostNumber(cidr: string): number {
  const parsed = parseCidr(cidr);
  if (parsed === undefined) throw new Error(`not an IPv4 network: ${cidr}`);
  return 2 ** (32 - parsed.prefix) - 2;
}

/** `addressOn('192.0.2.0/24', 11)` is `192.0.2.11`. */
export function addressOn(cidr: string, hostNumber: number): string {
  const parsed = parseCidr(cidr);
  if (parsed === undefined) throw new Error(`not an IPv4 network: ${cidr}`);
  if (hostNumber < 1 || hostNumber > lastHostNumber(cidr)) {
    throw new Error(`host number ${hostNumber} does not fit ${cidr}`);
  }
  return dotted(parsed.base + hostNumber);
}
