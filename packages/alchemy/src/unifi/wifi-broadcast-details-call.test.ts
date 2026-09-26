/**
 * T23 static guard (red team, IMPORTANT-2, 2026-09-26): no file under `src/unifi` may reference
 * `getWifiBroadcastDetails` — the single-object WiFi Broadcast GET whose `securityConfiguration`
 * carries the WPA passphrase and every PPSK entry's own passphrase (`wifi-broadcast.ts`'s header;
 * SDK `wifi_broadcasts.ts`). Confirmed missing before this file existed: `write-op-reference.test.ts`
 * only bans WRITE verbs (create/update/delete/patch/execute/remove/adopt) — nothing stopped a
 * future edit from calling this GET, even though it is exactly as forbidden here as a write op is.
 *
 * ⛔ NOT MERGED INTO `write-op-reference.test.ts`'s OWN SCAN. That scan's `WRITE_OP_NAME` regex and
 *   its `sdkWriteOpNames` harvest are BOTH scoped to `BANNED_VERBS` — `getWifiBroadcastDetails`
 *   starts with `get`, so it can never match there, and widening that regex to catch it would also
 *   start matching ordinary read helpers this family and every other one legitimately call
 *   (`getNetworkDetails`, `getWifiBroadcastPage`, …). This is a single hand-named token, not a verb
 *   class, so it gets its own small scan built on the SAME comment/string-aware scanner
 *   (`scan-source.ts`) rather than a real design bent to fit inside the other one.
 *
 * ⚠️ NO `SDK_MARKER` GATE, UNLIKE `write-op-reference.test.ts`. That gate exists there because
 *   `create`/`delete`/… are common English words that need the "and this file imports the SDK" ANDed
 *   check to avoid false positives; `getWifiBroadcastDetails` is specific enough that its bare
 *   appearance anywhere in code (not a comment) already IS the offense, with no plausible unrelated
 *   source for that exact identifier.
 *
 * ⛔ ONE NAMED EXCEPTION, NOT A PATTERN. `errors-and-secrets.test.ts` (pre-dates this file — A2,
 *   kit PR #300) calls `getWifiBroadcastDetails` directly ON PURPOSE: it is the runtime proof that
 *   the SDK's OWN regen redacts the WPA/PPSK passphrase to `Redacted.Redacted<string>` at the wire
 *   (T23's `sensitivePatterns` fix), which is impossible to prove without actually calling the
 *   details endpoint at the SDK layer. That is a DIFFERENT claim from this ban's actual target —
 *   "no `Unifi.WifiBroadcast` RESOURCE/family file ever calls it" — so it is named here explicitly,
 *   not folded into a looser rule that would also excuse a future family file. A new exception
 *   needs the same caliber of justification (proving a lower-layer guarantee that cannot be proven
 *   without the call) and its own line here, not a widened pattern.
 */
import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource, stripComments, walk } from './scan-source.ts';

const SELF = fileURLToPath(import.meta.url);
const DIR = dirname(SELF);
const BANNED_TOKEN = 'getWifiBroadcastDetails';
const TOKEN_PATTERN = new RegExp(`\\b${BANNED_TOKEN}\\b`);

/** The one file allowed to reference the banned token, and why — see this file's header. */
const ALLOWED_REFERENCES: ReadonlySet<string> = new Set([join(DIR, 'errors-and-secrets.test.ts')]);

const sourceFiles = () =>
  walk(DIR).filter((path) => path !== SELF && !ALLOWED_REFERENCES.has(path));

const referencesBannedToken = (rawSrc: string): boolean =>
  TOKEN_PATTERN.test(stripComments(rawSrc));

describe('src/unifi never calls getWifiBroadcastDetails (T23, IMPORTANT-2)', () => {
  test('every source file, except the one named exception, is clean of the details call', () => {
    const offenders = sourceFiles().filter((path) => referencesBannedToken(readSource(path)));
    expect(offenders).toEqual([]);
  });

  test('the named exception still exists and still is the one making the call (guards a silent rename)', () => {
    const [exceptionPath] = [...ALLOWED_REFERENCES];
    if (exceptionPath === undefined) throw new Error('ALLOWED_REFERENCES must not be empty');
    expect(referencesBannedToken(readSource(exceptionPath))).toBe(true);
  });

  test('a comment or prose mention of the banned name never trips the scan', () => {
    // This file's own header, and wifi-broadcast.ts's, both name the token in prose -- proving the
    // scan is comment-aware IS the point: a naive substring scan would flag the very files that
    // document why the call is forbidden.
    const documented = `
      /** Never call getWifiBroadcastDetails directly -- see T23. */
      // getWifiBroadcastDetails is refused by policy.ts too.
      export const read = () => 1;
    `;
    expect(referencesBannedToken(documented)).toBe(false);
  });

  test('a real reference to the banned call is caught regardless of syntax shape', () => {
    const marker = '@distilled.cloud/unifi-network/wifi_broadcasts';
    const cases = [
      `import { getWifiBroadcastDetails } from '${marker}';`,
      `import { getWifiBroadcastDetails as readOne } from '${marker}'; readOne;`,
      `export { getWifiBroadcastDetails } from '${marker}';`,
      `const fn = (m: Record<string, unknown>) => m['getWifiBroadcastDetails'];`,
      `const fn = async () => (await import('${marker}')).getWifiBroadcastDetails;`,
    ];
    for (const src of cases) expect(referencesBannedToken(src)).toBe(true);
  });

  test('the walk is recursive, matching write-op-reference.test.ts', () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
    expect(sourceFiles()).not.toContain(SELF);
  });
});
