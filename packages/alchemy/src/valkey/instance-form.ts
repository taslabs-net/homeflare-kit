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

/** Parse the `INFO` bulk reply into the fields `Instance` cares about. */
export const parseInfo = (value: string | null): ValkeyInstanceInfo => {
  const fallback = '0.0.0';
  if (value === null) return { version: fallback };
  const match = /redis_version:([0-9a-zA-Z._-]+)/.exec(value);
  return { version: match?.[1] ?? fallback };
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
  port: props.port,
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
    if (declared !== undefined && declared !== liveValue) {
      return { prop, declared, live: liveValue };
    }
  }
  return undefined;
};
