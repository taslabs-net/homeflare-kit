/**
 * Pure helpers for `Valkey.Instance`: parsing `INFO`/`CONFIG GET` replies, building drift checks,
 * and normalising optional props.
 *
 * ⛔ NO SIDE EFFECTS. Everything in this file is a pure function that can be unit-tested without a
 *   socket or a fake executor.
 */
import type {
  ValkeyInstanceAttributes,
  ValkeyInstanceConfig,
  ValkeyInstanceInfo,
  ValkeyInstanceProps,
} from './instance-attrs.ts';

/** Parse the `INFO` bulk reply into the fields `Instance` cares about. A missing `tcp_port`
 * is 0, so a declaration of a real port drifts rather than matching a reply that omitted it. */
export const parseInfo = (value: string | null): ValkeyInstanceInfo => {
  const fallback = '0.0.0';
  if (value === null) return { version: fallback, port: 0 };
  const match = /valkey_version:([0-9a-zA-Z._-]+)/.exec(value);
  const port = /tcp_port:([0-9]+)/.exec(value);
  return {
    version: match?.[1] ?? fallback,
    port: port?.[1] === undefined ? 0 : Number(port[1]),
  };
};

/** Valkey `memtoull` (`src/util.c`, same on 8.1.10 and 9.1.1). `mb` is 1024², so `512mb` is
 * 536870912 and `256mb` is 268435456 — the byte string `CONFIG GET` returns for `MEMORY_CONFIG`.
 * Undefined on a parse error: a zero from the C function is "unlimited" only for the string `0`. */
const MEMORY_UNITS: Readonly<Record<string, bigint>> = {
  '': 1n,
  b: 1n,
  k: 1000n,
  kb: 1024n,
  m: 1_000_000n,
  mb: 1024n * 1024n,
  g: 1_000_000_000n,
  gb: 1024n * 1024n * 1024n,
};

export const memoryBytes = (value: string): bigint | undefined => {
  if (value.startsWith('-')) return undefined;
  const match = /^(\d+)([a-z]*)$/i.exec(value);
  if (match === null) return undefined;
  const digits = match[1];
  const unit = (match[2] ?? '').toLowerCase();
  const mul = MEMORY_UNITS[unit];
  if (digits === undefined || mul === undefined) return undefined;
  return BigInt(digits) * mul;
};

/** Byte equality for `maxmemory`. An unparseable side does not match, so a typo still drifts. */
const sameMemory = (declared: string, live: string): boolean => {
  const left = memoryBytes(declared);
  const right = memoryBytes(live);
  return left !== undefined && right !== undefined && left === right;
};

/** Fill defaults for absent optional config so `diff` and drift checks compare a concrete string. */
const defaultedConfig = (raw: Partial<ValkeyInstanceConfig>): ValkeyInstanceConfig => ({
  maxmemory: raw.maxmemory ?? '0',
  maxmemoryPolicy: raw.maxmemoryPolicy ?? 'noeviction',
  appendonly: raw.appendonly ?? 'no',
});

/** Build a live `ValkeyInstanceAttributes` from parsed `INFO` and `CONFIG GET` pairs. */
export const buildAttributes = (
  props: Omit<ValkeyInstanceProps, 'maxmemory' | 'maxmemoryPolicy' | 'appendonly'>,
  info: ValkeyInstanceInfo,
  config: Partial<ValkeyInstanceConfig>,
): ValkeyInstanceAttributes => ({
  name: props.name,
  port: info.port,
  version: info.version,
  ...defaultedConfig(config),
});

/** Compare every declared assert-once prop against the live row. Returns the first drift, or
 * `undefined` when every declared prop matches. */
export const firstDrift = (
  props: ValkeyInstanceProps,
  live: ValkeyInstanceAttributes,
): { readonly prop: string; readonly declared: unknown; readonly live: unknown } | undefined => {
  const checks: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ['port', props.port, live.port],
    ['maxmemory', props.maxmemory, live.maxmemory],
    ['maxmemoryPolicy', props.maxmemoryPolicy, live.maxmemoryPolicy],
    ['appendonly', props.appendonly, live.appendonly],
  ];
  for (const [prop, declared, liveValue] of checks) {
    if (declared === undefined) continue;
    if (
      prop === 'maxmemory' &&
      typeof declared === 'string' &&
      typeof liveValue === 'string' &&
      sameMemory(declared, liveValue)
    ) {
      continue;
    }
    if (declared !== liveValue) return { prop, declared, live: liveValue };
  }
  return undefined;
};
