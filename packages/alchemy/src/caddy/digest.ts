/**
 * The one form an adapted Caddy config is hashed in — so what `POST /adapt` returns for the
 * declared Caddyfile and what `GET /config/` reports after the load hash the same.
 *
 * ⛔ THE TWO ARE NOT THE SAME BYTES, AND COMPARING BYTES WOULD BE A FOREVER-`update`. Read in
 *   caddyserver/caddy v2.11.4:
 *   · `/adapt` returns the adapter's `json.Marshal(cfg)` of Go STRUCTS — keys in field order
 *     (caddyconfig/caddyfile/adapter.go Adapt; load.go handleAdapt).
 *   · `/load` decodes that JSON into a generic `any` and re-marshals it (caddy.go changeConfig):
 *     Go sorts MAP keys, so the stored config has every object's keys sorted.
 *   · `GET /config/` streams that stored value through `json.Encoder`, which appends a newline
 *     (admin.go unsyncedConfigAccess), and escapes `<`, `>` and `&` as `\u003c`, `\u003e`, `\u0026`.
 *   Parsing both and re-serialising with sorted keys erases all three differences. MEASURED
 *   2026-09-21 on a throwaway Caddy 2.11.4: the digest of `GET /config/` after `POST /load` equals
 *   the digest of `/adapt` for the same Caddyfile — and a Caddy started with `--config <file>`
 *   hashes the same as `/adapt` of that file's text, so adopting it is a noop.
 * ★ NUMBERS AGREE BY CONSTRUCTION. Go decodes every JSON number in that generic `any` as float64
 *   (caddy.go indexConfigObjects says so), and JSON.parse does too — the same double on both sides
 *   serialises the same way here.
 */
import { sha256Hex } from '../launchd/job-form.ts';

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

const sorted = (value: Json): Json => {
  if (Array.isArray(value)) return (value as readonly Json[]).map(sorted);
  if (typeof value === 'object' && value !== null) {
    const object = value as { readonly [key: string]: Json };
    const out: Record<string, Json> = {};
    for (const key of Object.keys(object).sort()) out[key] = sorted(object[key] ?? null);
    return out;
  }
  return value;
};

/** Parse a config body Caddy returned. ⚠️ An empty config is the JSON `null`, not an error. */
export const parseConfig = (text: string): unknown => JSON.parse(text) as unknown;

/** The canonical text of a parsed config: sorted keys, no whitespace. */
export const canonicalConfig = (config: unknown): string =>
  JSON.stringify(sorted((config ?? null) as Json));

/** SHA-256 of the canonical form — what the resource stores and compares, never the config. */
export const configDigest = (config: unknown): string => sha256Hex(canonicalConfig(config));
