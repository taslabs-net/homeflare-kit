/**
 * RELATIVITY: change one base value, and every derived output changes by pure
 * substitution of that value — nothing else moves.
 *
 * ★ WHY THIS IS THE TEST THAT MATTERS. It is what "no stack types a hostname" means in
 *   practice. If a rule ever mixed in a literal, or derived one name from another's
 *   rendering, swapping the apex would leave a stale fragment behind or change something
 *   unrelated, and this fails naming the base value.
 *
 * ⚠️ Values here are SENTINELS, not the example's short labels. `v` as a vault label is a
 *   substring of half the render, so replacing it would "pass" by accident. Each base value
 *   is first set to a unique token, then swapped for another.
 */
import { describe, expect, test } from 'bun:test';
import { decodeSite, derive } from '../src/index.ts';
import { example, render, withPath } from './fixture.ts';

type Swap = {
  readonly name: string;
  /** Paths that hold this base value (the apex also appears in the account's zone list). */
  readonly paths: readonly (readonly (string | number)[])[];
  readonly from: string;
  readonly to: string;
};

const SWAPS: readonly Swap[] = [
  {
    name: 'apex',
    paths: [['apex'], ['cloudflare', 'accounts', 'main', 'zones', 0]],
    from: 'apexsentinel.example.org',
    to: 'swapped.example.net',
  },
  { name: 'vault label', paths: [['vault', 'label']], from: 'vaultsentinel', to: 'vswapped' },
  { name: 'vault API label', paths: [['vault', 'apiLabel']], from: 'apisentinel', to: 'aswapped' },
  { name: 'mgmt zone label', paths: [['zones', 'mgmt']], from: 'mgmtsentinel', to: 'mswapped' },
  { name: 'lab zone label', paths: [['zones', 'lab']], from: 'labsentinel', to: 'lswapped' },
  {
    name: 'Access team',
    paths: [['cloudflare', 'access', 'team']],
    from: 'teamsentinel',
    to: 'tswapped',
  },
  { name: 'OIDC mount', paths: [['vault', 'oidcMount']], from: 'oidcsentinel', to: 'oswapped' },
  {
    name: 'mesh address',
    paths: [['vault', 'meshAddress']],
    from: '198.19.77.77',
    to: '198.19.66.66',
  },
];

function renderWith(swap: Swap, value: string): string {
  let input = example();
  for (const path of swap.paths) input = withPath(input, path, value);
  return render(derive(decodeSite(input)));
}

describe('every derived output is relative to base values', () => {
  for (const swap of SWAPS) {
    test(`${swap.name}: swapping it is pure substitution`, () => {
      const before = renderWith(swap, swap.from);
      const after = renderWith(swap, swap.to);

      // ⛔ The sentinel must actually appear, or the substitution proves nothing.
      expect(before).toContain(swap.from);
      expect(after).not.toContain(swap.from);
      expect(after).toBe(before.replaceAll(swap.from, swap.to));
    });
  }

  test('a network move changes addresses by substitution of the prefix', () => {
    const at = (cidr: string) =>
      render(derive(decodeSite(withPath(example(), ['networks', 'lab'], cidr))));
    const before = at('198.51.100.0/24');
    const after = at('198.19.201.0/24');
    expect(after).toBe(before.replaceAll('198.51.100.', '198.19.201.'));
  });

  test('the sentinel check can fail: a leftover literal is caught', () => {
    // Guard the guard. A render that kept one stale fragment must not equal the substitution.
    const swap = SWAPS[0];
    if (swap === undefined) throw new Error('no swaps');
    const before = renderWith(swap, swap.from);
    const broken = `${renderWith(swap, swap.to)}${swap.from}`;
    expect(broken).not.toBe(before.replaceAll(swap.from, swap.to));
  });
});
