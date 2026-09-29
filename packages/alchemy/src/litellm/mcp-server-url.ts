/**
 * The URL half of `LiteLLM.MCPServer`: what a declared URL may not carry, and what a live one is
 * scrubbed of before it reaches Alchemy's state.
 *
 * ⛔ THE URL IS A PROP, SO IT LANDS IN AN UNENCRYPTED STATE STORE. A secret in it (userinfo, a
 *   `?token=`) would be persisted, so a declaration is refused for carrying one and a live row's
 *   URL is redacted on the way in. The credential is `authValue`, never the URL.
 */
import { isBlank } from './mcp-server-types.ts';

/** A query parameter whose NAME says it carries a secret. */
const SECRET_PARAM = /token|secret|passw|api.?key|auth|credential|signature|^key$|^sig$/i;

/** Why a URL may not be declared, or `undefined`. ⛔ Never quotes the URL: it may hold the secret. */
export const urlProblem = (raw: unknown): string | undefined => {
  if (isBlank(raw)) return '`url` must be a non-empty string';
  let url: URL;
  try {
    url = new URL(raw as string);
  } catch {
    return '`url` must be a full http(s) URL including the scheme';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '`url` must be http or https';
  if (url.username !== '' || url.password !== '') {
    return '`url` must not carry userinfo; declare the credential as `authValue`';
  }
  if (url.hash !== '') return '`url` must not carry a fragment';
  for (const name of url.searchParams.keys()) {
    if (SECRET_PARAM.test(name)) {
      return `\`url\` carries the query parameter "${name}", which looks like a credential; declare it as \`authValue\` instead, because the URL is stored in Alchemy's state`;
    }
  }
  return undefined;
};

/**
 * `userinfo` and secret-looking query values replaced with `REDACTED`, so a live URL that carries a
 * token never reaches Alchemy's unencrypted state.
 * ★ A URL THAT NEEDS NO REDACTION COMES BACK BYTE-FOR-BYTE, never re-serialised: `URL#toString`
 *   adds a trailing slash to a bare origin, and a declared `https://host` would then differ from
 *   its own live row on every plan. A URL that does not parse is returned as it is.
 */
export const redactUrl = (raw: string): string => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  let changed = false;
  if (url.username !== '') {
    url.username = 'REDACTED';
    changed = true;
  }
  if (url.password !== '') {
    url.password = 'REDACTED';
    changed = true;
  }
  // ⚠️ A Set first: `set` mutates the live iterator's list, and a repeated name would be skipped.
  for (const name of new Set(url.searchParams.keys())) {
    if (!SECRET_PARAM.test(name)) continue;
    url.searchParams.set(name, 'REDACTED');
    changed = true;
  }
  return changed ? url.toString() : raw;
};
