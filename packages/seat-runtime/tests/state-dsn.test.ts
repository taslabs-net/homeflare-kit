/**
 * What is read from a DSN, and that the string itself never comes back out (src/state-dsn.ts).
 */
import { describe, expect, test } from 'bun:test';
import { postgresFields, valkeyFields } from '../src/state-dsn.ts';

/** Made per run so the assertion is about the value, not about a constant a scanner would flag. */
const SECRET = `pw-${crypto.randomUUID()}`;

describe('postgresFields', () => {
  test('reads host, port, database and user, decoded, and nothing else', () => {
    const fields = postgresFields(`postgres://se%40t:${SECRET}@db.example:6543/my%20db`);
    expect(fields).toEqual({
      host: 'db.example',
      port: 6543,
      database: 'my db',
      username: 'se@t',
    });
    expect(JSON.stringify(fields)).not.toContain(SECRET);
  });

  test('leaves out what the URL leaves out', () => {
    expect(postgresFields('postgresql://db.example')).toEqual({
      host: 'db.example',
      port: undefined,
      database: undefined,
      username: undefined,
    });
  });

  test('an IPv6 host loses its brackets, as the driver does', () => {
    expect(postgresFields('postgres://u@[::1]:5432/d')?.host).toBe('::1');
  });

  test('a socket directory in the host is decoded, as the driver decodes it', () => {
    expect(postgresFields('postgres://u@%2Fvar%2Frun%2Fpostgresql/d')?.host).toBe(
      '/var/run/postgresql',
    );
  });

  test.each(['host', 'port', 'user', 'dbname'])(
    'derives nothing when `?%s=` overrides the authority in the driver',
    (key) => {
      expect(postgresFields(`postgres://u@a:1/d?${key}=x`)).toEqual({});
    },
  );

  test('a piece that will not decode or parse is left to the driver', () => {
    expect(postgresFields('postgres://u@h/%E0%A4%A')).toEqual({});
    expect(postgresFields('postgres://u@h:0/d')).toEqual({});
  });

  test('undefined for what `new URL` cannot parse, which is where the driver leaks', () => {
    expect(postgresFields(`not a url ${SECRET}`)).toBeUndefined();
    expect(postgresFields(`postgres://u:${SECRET}@host:notaport/db`)).toBeUndefined();
    expect(postgresFields(`postgres://u:${SECRET}@[::1/db`)).toBeUndefined();
  });

  test('a scheme the driver rejects still parses: the driver names it without the string', () => {
    expect(postgresFields(`mysql://u:${SECRET}@h/d`)).toBeDefined();
  });
});

describe('valkeyFields', () => {
  test('reads host, port and the logical database', () => {
    expect(valkeyFields(`redis://seat:${SECRET}@10.0.0.1:6381/2`)).toEqual({
      host: '10.0.0.1',
      port: 6381,
      database: '2',
    });
  });

  test('the port defaults to 6379 and the database to none', () => {
    expect(valkeyFields('valkey://cache.example')).toEqual({
      host: 'cache.example',
      port: 6379,
      database: undefined,
    });
  });

  test('takes every scheme Bun.RedisClient takes', () => {
    for (const scheme of ['redis', 'valkey', 'rediss', 'valkeys', 'redis+tls']) {
      expect(valkeyFields(`${scheme}://h`)).toBeDefined();
    }
    expect(valkeyFields('redis+unix:///run/valkey.sock')).toEqual({});
  });

  test('undefined for another scheme or a non-URL', () => {
    expect(valkeyFields(`http://u:${SECRET}@h`)).toBeUndefined();
    expect(valkeyFields(`postgres://u:${SECRET}@h`)).toBeUndefined();
    expect(valkeyFields(`not a url ${SECRET}`)).toBeUndefined();
  });
});
