import { describe, expect, test } from 'bun:test';
import { EnvError, parseEnv } from '../src/env.ts';

describe('parseEnv', () => {
  test('reads strings, numbers and booleans', () => {
    const parsed = parseEnv(
      { NAME: { type: 'string' }, PORT: { type: 'number' }, DEBUG: { type: 'boolean' } },
      { NAME: 'kit', PORT: '8080', DEBUG: 'true' },
    );

    expect(parsed).toEqual({ NAME: 'kit', PORT: 8080, DEBUG: true });
  });

  // ⚠️ The regression this whole module is for: Boolean('false') === true.
  test("treats 'false' and 'off' as false, not as a non-empty string", () => {
    const parsed = parseEnv(
      { A: { type: 'boolean' }, B: { type: 'boolean' } },
      { A: 'false', B: 'OFF' },
    );

    expect(parsed.A).toBe(false);
    expect(parsed.B).toBe(false);
  });

  test('rejects a boolean spelling it cannot be sure about', () => {
    expect(() => parseEnv({ A: { type: 'boolean' } }, { A: 'maybe' })).toThrow(EnvError);
  });

  test('applies defaults and honours optional', () => {
    const parsed = parseEnv(
      { PORT: { type: 'number', default: 3000 }, EXTRA: { type: 'string', optional: true } },
      {},
    );

    expect(parsed.PORT).toBe(3000);
    expect(parsed.EXTRA).toBeUndefined();
  });

  test('an empty string counts as unset, so a default still applies', () => {
    const parsed = parseEnv({ PORT: { type: 'number', default: 3000 } }, { PORT: '' });
    expect(parsed.PORT).toBe(3000);
  });

  test('names the key but never the value when it throws', () => {
    try {
      parseEnv({ TOKEN: { type: 'string' } }, {});
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as EnvError).key).toBe('TOKEN');
    }
  });

  // 🔴 THE INCIDENT THIS PREVENTS, MEASURED 2026-09-02 IN PRODUCTION. An unbound workerd
  //   binding arrives as the STRING "null", not undefined. Sixteen of twenty hand-rolled
  //   clients accepted it and sent `Authorization: Bearer null`; the resulting bare 401
  //   reads as "wrong token" and sends an operator to rotate a good credential.
  test.each(['null', 'undefined', '', '  '])('treats %p as unset, not as a value', (raw) => {
    expect(() => parseEnv({ TOKEN: { type: 'string' } }, { TOKEN: raw })).toThrow(EnvError);
  });

  test('a default applies when the value is the string "null"', () => {
    const parsed = parseEnv({ PORT: { type: 'number', default: 3000 } }, { PORT: 'null' });
    expect(parsed.PORT).toBe(3000);
  });

  test('trims surrounding whitespace — a rendered env file has a trailing newline', () => {
    const parsed = parseEnv({ TOKEN: { type: 'string' } }, { TOKEN: '  secret\n' });
    expect(parsed.TOKEN).toBe('secret');
  });

  test('rejects a number that is not one', () => {
    expect(() => parseEnv({ PORT: { type: 'number' } }, { PORT: 'eighty' })).toThrow(EnvError);
  });
});
