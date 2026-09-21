/**
 * The example — and everything derived from it — names ONLY reserved things:
 * RFC 2606 domains (example.com / .net / .org) and RFC 5737 / RFC 2544 addresses.
 *
 * ⛔ NEVER 10/8 OR 100.64/10 IN A PLACEHOLDER. The estate lives there, so a placeholder in
 *   those ranges would teach the leak gate to ignore exactly the addresses it must catch.
 * ⚠️ `cloudflareaccess.com` and `localhost` are allowed by name: the first is the vendor's
 *   own suffix for every Access team, the second is the CLI's OIDC listener. Neither
 *   carries a site value by itself.
 */
import { describe, expect, test } from 'bun:test';
import { decodeSite, derive, tokenValues } from '../src/index.ts';
import { EXAMPLE_PATH, example, render } from './fixture.ts';

const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];
const VENDOR_SUFFIXES = ['cloudflareaccess.com'];

/** RFC 5737 TEST-NET-1/2/3 and RFC 2544 benchmarking (198.18.0.0/15). */
function reservedAddress(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a === 198 && (b === 18 || b === 19);
}

/** Every dotted name in `text` that is not an address. */
function hostnames(text: string): string[] {
  return [...text.matchAll(/(?<![\w.-])[a-z0-9-]+(\.[a-z0-9-]+)+(?![\w-])/gi)]
    .map((m) => m[0].toLowerCase())
    .filter((name) => !/^[\d.]+$/.test(name) && !/^\d+\.\d+\.\d+(-|$)/.test(name));
}

function addresses(text: string): string[] {
  return [...text.matchAll(/\b\d{1,3}(\.\d{1,3}){3}\b/g)].map((m) => m[0]);
}

function offenders(text: string): string[] {
  const badNames = hostnames(text).filter(
    (name) =>
      ![...RESERVED_DOMAINS, ...VENDOR_SUFFIXES].some(
        (ok) => name === ok || name.endsWith(`.${ok}`),
      ) && !name.includes('@'),
  );
  const badIps = addresses(text).filter((ip) => !reservedAddress(ip));
  return [...badNames, ...badIps];
}

/**
 * Every string VALUE in the file, plus every record key except pin keys.
 * ⚠️ Pin keys (`alerts.d1`, `ssh-host.host`) are dotted identifiers a consumer chooses, not
 *   names on the network, and a text scan reads them as hostnames. Their values are
 *   scanned like everything else.
 */
function strings(node: unknown, path: readonly string[] = []): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap((item) => strings(item, path));
  if (typeof node !== 'object' || node === null) return [];
  const underPins = path.length === 2 && path[0] === 'pinned';
  return Object.entries(node).flatMap(([key, value]) => [
    ...(underPins ? [] : [key]),
    ...strings(value, [...path, key]),
  ]);
}

const site = decodeSite(example());
const exampleText = strings(await Bun.file(EXAMPLE_PATH).json()).join('\n');

describe('reserved-only placeholders', () => {
  test('the example file names only reserved domains and addresses', () => {
    // Emails are checked by their domain part, which the hostname scan already covers.
    expect(offenders(exampleText.replaceAll(/^[\w.-]+@/gm, ''))).toEqual([]);
  });

  test('the full render (derive + token values) names only reserved things', () => {
    const text = `${render(derive(site))}\n${render(tokenValues(site))}`;
    expect(offenders(text)).toEqual([]);
  });

  test('never an address in 10/8 or 100.64/10', () => {
    for (const ip of [...addresses(exampleText), ...addresses(render(derive(site)))]) {
      const [a, b] = ip.split('.').map(Number);
      expect(a).not.toBe(10);
      expect(a === 100 && b !== undefined && b >= 64 && b < 128).toBe(false);
    }
  });

  test('the scan itself catches a live-looking value (it can fail)', () => {
    // ⚠️ Deliberately NOT modelled on any real network: these only have to be unreserved.
    expect(offenders('host.corp.lab.invalid at 10.200.30.40 via 100.64.9.9')).toEqual([
      'host.corp.lab.invalid',
      '10.200.30.40',
      '100.64.9.9',
    ]);
    expect(offenders('192.0.2.1 198.19.0.1 v.example.com')).toEqual([]);
  });
});
