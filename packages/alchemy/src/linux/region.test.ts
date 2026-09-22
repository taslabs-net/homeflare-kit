/**
 * The managed region, byte for byte. ⛔ The load-bearing assertion in this file is that everything
 *   outside the markers is IDENTICAL — not similar, not re-terminated. Every consumer of this mode
 *   owns four lines inside a file that belongs to a vendor, a package or a person.
 */
import { describe, expect, test } from 'bun:test';
import { readRegion, regionProblems, removeRegion, spliceRegion } from './region.ts';

const spec = { name: 'homeflare-example' };
const HOST_FILE = [
  '# Loopback, from the OS vendor',
  '127.0.0.1\tlocalhost',
  '::1\t\tlocalhost ip6-localhost',
  '',
  '10.0.0.1\tsomething.invalid',
  '',
].join('\n');

describe('splice', () => {
  test('appends the block and leaves every other byte identical', () => {
    const next = spliceRegion(HOST_FILE, spec, '10.0.0.2\tdeclared.invalid\n');
    expect(next.startsWith(HOST_FILE)).toBe(true);
    expect(next.slice(HOST_FILE.length)).toBe(
      '# BEGIN homeflare-example\n10.0.0.2\tdeclared.invalid\n# END homeflare-example\n',
    );
  });

  test('replaces the block in place, and the surroundings survive a rewrite', () => {
    const once = spliceRegion(HOST_FILE, spec, 'one\n');
    const twice = spliceRegion(once, spec, 'two\nthree\n');
    expect(readRegion(twice, spec)).toBe('two\nthree\n');
    expect(removeRegion(twice, spec)).toBe(HOST_FILE);
    // ★ The block stayed where it was: nothing after it moved above it.
    expect(twice.indexOf('# BEGIN')).toBe(once.indexOf('# BEGIN'));
  });

  test('a file with no final newline gets exactly one, and nothing else', () => {
    const next = spliceRegion('alpha', spec, 'body\n');
    expect(next).toBe('alpha\n# BEGIN homeflare-example\nbody\n# END homeflare-example\n');
  });

  test('an empty body is still a block, so the markers hold the place', () => {
    const next = spliceRegion('', spec, '');
    expect(next).toBe('# BEGIN homeflare-example\n# END homeflare-example\n');
    expect(readRegion(next, spec)).toBe('');
  });

  test('the comment token is the host file’s own', () => {
    const next = spliceRegion('// vendor\n', { comment: '//', name: 'block' }, 'x\n');
    expect(next).toBe('// vendor\n// BEGIN block\nx\n// END block\n');
  });

  test('two blocks in one file do not see each other', () => {
    const first = spliceRegion(HOST_FILE, { name: 'a' }, 'alpha\n');
    const both = spliceRegion(first, { name: 'b' }, 'beta\n');
    expect(readRegion(both, { name: 'a' })).toBe('alpha\n');
    expect(readRegion(both, { name: 'b' })).toBe('beta\n');
    expect(removeRegion(removeRegion(both, { name: 'b' }), { name: 'a' })).toBe(HOST_FILE);
  });
});

describe('refusals', () => {
  const half = '# BEGIN homeflare-example\nbody\n';
  test('a BEGIN with no END is a refusal, not a guess', () => {
    expect(() => readRegion(half, spec)).toThrow(/BEGIN marker and no match/);
  });

  test('an END before its BEGIN is a refusal', () => {
    const broken = '# END homeflare-example\nbody\n# BEGIN homeflare-example\n';
    expect(() => readRegion(broken, spec)).toThrow(/END marker before its BEGIN/);
  });

  test('two BEGIN markers name the lines rather than picking one', () => {
    const doubled = `${half}# END homeflare-example\n${half}# END homeflare-example\n`;
    expect(() => spliceRegion(doubled, spec, 'x\n')).toThrow(/two BEGIN markers .*lines 1, 4/);
  });

  test('a name or comment that could not be found verbatim is refused up front', () => {
    expect(regionProblems({ name: 'has\nnewline' })).toHaveLength(1);
    expect(regionProblems({ comment: '# ', name: 'ok' })).toHaveLength(1);
    expect(regionProblems({ comment: ';', name: 'ok-1' })).toEqual([]);
  });
});

describe('remove', () => {
  test('is a no-op when the block is not there', () => {
    expect(removeRegion(HOST_FILE, spec)).toBe(HOST_FILE);
  });
});
