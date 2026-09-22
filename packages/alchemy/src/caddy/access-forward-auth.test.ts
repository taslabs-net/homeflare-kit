import { describe, expect, test } from 'bun:test';
import { accessForwardAuth, verifierProblems } from './access-forward-auth.ts';

describe('accessForwardAuth', () => {
  test('emits a forward_auth block with the identity headers copied', () => {
    const block = accessForwardAuth({
      verifier: '127.0.0.1:9101',
      body: ['reverse_proxy 127.0.0.1:6080'],
    });

    expect(block).toBe(
      [
        '\treverse_proxy 127.0.0.1:6080',
        '\tforward_auth 127.0.0.1:9101 {',
        '\t\turi /access/verify',
        '\t\tcopy_headers {',
        '\t\t\tX-Access-Email',
        '\t\t\tX-Access-Sub',
        '\t\t}',
        '\t}',
      ].join('\n'),
    );
  });

  test('copies exactly the headers the verifier sets, by default', () => {
    // ⛔ A header the verifier emits but Caddy does not copy never reaches the upstream;
    //    a header Caddy copies but the verifier never sets is the SPOOFING case — the
    //    client's own value survives. These two lists must agree, which is why the default
    //    is not configurable-by-accident.
    const block = accessForwardAuth({ verifier: '127.0.0.1:9101' });
    expect(block).toContain('X-Access-Email');
    expect(block).toContain('X-Access-Sub');
  });

  test('refuses a verifier on a routable address', () => {
    // 🔴 A verifier reachable from off-box can be answered around, and the upstream with it.
    expect(() => accessForwardAuth({ verifier: '10.20.10.250:9101' })).toThrow(/loopback/);
    expect(() => accessForwardAuth({ verifier: '0.0.0.0:9101' })).toThrow(/loopback/);
  });

  test('accepts loopback in its usual spellings, and a unix socket', () => {
    for (const verifier of ['127.0.0.1:9101', 'localhost:9101', '[::1]:9101', 'unix//run/v.sock']) {
      expect(verifierProblems(verifier)).toEqual([]);
    }
  });

  test('a custom uri and header names flow through', () => {
    const block = accessForwardAuth({
      verifier: 'unix//run/access.sock',
      uri: '/verify/vnc',
      copyHeaders: ['Remote-Email'],
    });

    expect(block).toContain('forward_auth unix//run/access.sock {');
    expect(block).toContain('uri /verify/vnc');
    expect(block).toContain('Remote-Email');
    expect(block).not.toContain('X-Access-Sub');
  });

  test('refuses an empty verifier rather than emitting a block that adapts to nothing', () => {
    expect(() => accessForwardAuth({ verifier: '   ' })).toThrow(/empty/);
  });
});
