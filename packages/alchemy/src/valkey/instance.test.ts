/**
 * `Valkey.Instance` against `fake-valkey.ts`'s recording fake — read of a running instance,
 * drift refusals, and no writes ever issued. Every case reverts cleanly by reverting
 * `instance.ts`/`instance-form.ts` locally.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeValkey } from './fake-valkey.ts';
import { firstDrift, parseInfo } from './instance-form.ts';
import { readWithExecutor } from './instance.ts';
import type { ValkeyInstanceProps } from './instance-attrs.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);

const baseProps: Pick<ValkeyInstanceProps, 'name' | 'port'> = { name: 'valkey-seats', port: 6381 };

describe('read', () => {
  test('reads INFO and CONFIG GET into attributes', async () => {
    const fake = makeFakeValkey({
      port: 6381,
      config: { maxmemory: '512mb', 'maxmemory-policy': 'noeviction', appendonly: 'yes' },
    });
    const attrs = await run(readWithExecutor(fake, baseProps));
    expect(attrs).toEqual({
      name: 'valkey-seats',
      port: 6381,
      version: '8.1.10',
      maxmemory: '536870912',
      maxmemoryPolicy: 'noeviction',
      appendonly: 'yes',
    });
    expect(firstDrift({ ...baseProps, maxmemory: '512mb' }, attrs)).toBeUndefined();
    expect(fake.commands.map((c) => c.args[0])).toEqual(['INFO', 'CONFIG']);
  });

  test('defaults absent config to concrete values', async () => {
    const fake = makeFakeValkey({});
    const attrs = await run(readWithExecutor(fake, baseProps));
    expect(attrs.maxmemory).toBe('0');
    expect(attrs.maxmemoryPolicy).toBe('noeviction');
    expect(attrs.appendonly).toBe('no');
  });

  test('port is INFO tcp_port, so a 6381 declaration drifts against a 6380 server', async () => {
    const fake = makeFakeValkey({ port: 6380 });
    const attrs = await run(readWithExecutor(fake, { name: 'valkey-seats', port: 6381 }));
    expect(attrs.port).toBe(6380);
    expect(firstDrift({ name: 'valkey-seats', port: 6381 }, attrs)).toEqual({
      prop: 'port',
      declared: 6381,
      live: 6380,
    });
  });
});

describe('parseInfo', () => {
  test('extracts the version line and falls back on garbage', () => {
    expect(parseInfo('redis_version:8.1.10\nredis_mode:standalone').version).toBe('8.1.10');
    expect(parseInfo(null).version).toBe('0.0.0');
    expect(parseInfo('nothing here').version).toBe('0.0.0');
  });
});

describe('firstDrift', () => {
  const live = {
    name: 'valkey-seats',
    port: 6381,
    version: '8.1.10',
    maxmemory: '512mb',
    maxmemoryPolicy: 'noeviction',
    appendonly: 'yes',
  };

  test('reports the first mismatched declared prop', () => {
    expect(firstDrift({ name: 'x', port: 6380 }, live)).toEqual({
      prop: 'port',
      declared: 6380,
      live: 6381,
    });
    expect(firstDrift({ name: 'x', port: 6381, maxmemory: '1gb' }, live)).toEqual({
      prop: 'maxmemory',
      declared: '1gb',
      live: '512mb',
    });
  });

  test('ignores undefined (unasserted) props', () => {
    expect(firstDrift({ name: 'x', port: 6381, maxmemory: undefined }, live)).toBeUndefined();
  });

  test("declaration '512mb' matches the byte count CONFIG GET returns", () => {
    // Valkey memtoull: 512mb is 536870912, 256mb is 268435456 (8.1.10 and 9.1.1).
    expect(
      firstDrift(
        { name: 'x', port: 6381, maxmemory: '512mb' },
        { ...live, maxmemory: '536870912' },
      ),
    ).toBeUndefined();
    expect(
      firstDrift(
        { name: 'x', port: 6381, maxmemory: '256mb' },
        { ...live, maxmemory: '268435456' },
      ),
    ).toBeUndefined();
  });
});
