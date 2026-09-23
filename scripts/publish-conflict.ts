/**
 * Classify an `npm publish` failure: was this actually a successful publish that
 * `isPublished()` was too early to see, or a real failure that must still abort the
 * release?
 *
 * ⚠️ MEASURED 2026-09-23, taslabs-net/homeflare-kit run 35887402292. A release started
 *   ~3 minutes after the previous one had published @homeflare/alchemy@0.25.1 — two kit
 *   releases landing inside npm's own CDN propagation window, which parallel agents make
 *   common. `isPublished()`'s `bun pm view` read 0.25.1 as absent (the same lag the ⚠️
 *   note beside the npm-publish call already documents for a plain 404), so the script
 *   ran `npm publish` again, and npm answered:
 *     npm error code E409
 *     npm error 409 Conflict - PUT https://registry.npmjs.org/@homeflare%2falchemy -
 *       Cannot publish over previously staged version "0.25.1".
 *   That is npm telling us the version is already there — the exact fact `isPublished()`
 *   was trying to establish, just delivered one step later than the pre-check could use
 *   it. The old code threw on ANY non-zero exit and aborted the whole release before it
 *   reached @homeflare/config@0.11.0, even though nothing was actually wrong.
 *
 * ⛔ NARROW ON PURPOSE. npm reuses 409 for unrelated registry conflicts — a CouchDB-style
 *   "Document update conflict" is a real, documented one (npm/npm#3320) — and those are
 *   NOT "already published"; they must still abort the release the way any other publish
 *   failure does. So this matches the specific "previously staged|published version"
 *   wording npm uses for the propagation race (both phrasings are real: npm/cli#9889 has
 *   "staged", the older EPUBLISHCONFLICT-era wording said "published"), and when npm
 *   quotes a version in the message, requires it to be the version this call just tried
 *   to publish — a conflict naming some OTHER version is not this package's race.
 *
 * ⚠️ KNOWN GAP, ACCEPTED RATHER THAN CHASED. npm/cli#9889 also documents the same
 *   "previously staged version" text coming from a wedged, PHANTOM stage that never
 *   becomes a real published version — no stage-id, nothing `npm stage list` can see,
 *   nothing to retry. The error text alone cannot tell ordinary CDN lag from that rare
 *   case. Left to the existing end-of-run signal instead of a new one: the
 *   `GITHUB_STEP_SUMMARY` table below already re-checks the registry and reports such a
 *   package as "⏳ not visible yet" rather than "✅ on npm" — that is where a genuinely
 *   stuck package would show up, the same as it would for ordinary lag.
 */
export function isAlreadyPublishedConflict(
  result: { readonly code: number; readonly out: string },
  version: string,
): boolean {
  if (result.code === 0) return false;

  const looksLike409 = /\bE409\b/.test(result.out) || /\b409\s+Conflict\b/i.test(result.out);
  if (!looksLike409) return false;

  const match = result.out.match(/previously (?:staged|published) version(?:\s+"([^"]+)")?/i);
  if (match === null) return false;

  // ★ npm did not quote a version at all: still treat the E409 + phrase match as enough
  //   rather than throwing away a real signal over formatting this function has not seen.
  const quotedVersion = match[1];
  return quotedVersion === undefined || quotedVersion === version;
}
