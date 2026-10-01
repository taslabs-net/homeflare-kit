/**
 * The SCRAM-SHA-256 verifier `role-scram.ts` builds — the only password form this family ever
 * sends. The golden vector below was computed OUTSIDE node (`hashlib`/`hmac` from the Python 3
 * standard library, 2026-09-30) so the test is a cross-implementation check, not the function
 * re-deriving its own math.
 */
import { describe, expect, test } from 'bun:test';
import { scramSha256Verifier } from './role-scram.ts';

// A placeholder, never a credential; the salt is fixed so the vector is deterministic.
const GOLDEN_SALT = Buffer.from('a1b2c3d4e5f60718293a4b5c6d7e8f90', 'hex');
const PLACEHOLDER = 'placeholder-password';
const GOLDEN =
  'SCRAM-SHA-256$4096:obLD1OX2BxgpOktcbX6PkA==$' +
  'wP+XMQxcTjqewigDeRTAJB703b2ekDF1fCBumhTm4N8=:' +
  'Bcc+TZOxqllgMPNn8IX0u/TJpvlRhwqPJaNQ2VLm1F4=';

describe('scramSha256Verifier', () => {
  test('matches a verifier computed by an independent implementation', () => {
    expect(scramSha256Verifier(PLACEHOLDER, GOLDEN_SALT)).toBe(GOLDEN);
  });

  test('fresh salt per call, standard base64 parts at PostgreSQL defaults', () => {
    const shape =
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;
    const a = scramSha256Verifier(PLACEHOLDER);
    const b = scramSha256Verifier(PLACEHOLDER);
    expect(a).not.toBe(b);
    expect(a).toMatch(shape);
    expect(b).toMatch(shape);
  });

  test('a different password gives a different verifier for the same salt', () => {
    expect(scramSha256Verifier(PLACEHOLDER, GOLDEN_SALT)).not.toBe(
      scramSha256Verifier('placeholder-password-two', GOLDEN_SALT),
    );
  });
});
