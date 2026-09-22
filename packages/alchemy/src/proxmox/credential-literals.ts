/**
 * A credential written as a LITERAL in a plain prop — refused, because a plain prop is a value in
 * the state store.
 *
 * ⛔ THE HOLE THIS CLOSES, MEASURED 2026-09-22 (adversarial review of PR 95). write-only.ts keeps
 *   every `{ fromEnv }` value out of state, and the doc WARNED that a plain header value is a prop.
 *   A warning is not a guard: `header: { Authorization: 'Bearer <token>' }` planned, deployed, and
 *   left the token in the dumped state store — and so did `url: 'https://…?token=<token>'`. Alchemy
 *   stores props unencrypted (write-only.ts has the StateEncoding reading), so the only safe
 *   literal is one that is not a credential.
 *
 * ★ WHAT COUNTS AS A CREDENTIAL IS A NAME, NOT A VALUE. A value cannot be recognised — a token is
 *   any string — but where it sits can: an `Authorization`/`Cookie` header, a header or query
 *   parameter whose name has a word like `token`, `key`, `secret`, `password` or `signature`, and a
 *   password in the URL's userinfo. A false positive costs one edit (declare it `{ fromEnv }`, or
 *   hold it in `secret` and write `{{ secrets.<name> }}`); a false negative costs a leaked token.
 * ★ A TEMPLATE THAT READS A SECRET IS NOT A LITERAL. `Bearer {{ secrets.token }}`, and
 *   `{{ url-encode secrets.token }}` in a query, render on PBS from the root-only secret store —
 *   the prop holds the reference, not the value.
 *
 * ⚠️ WHAT THIS CANNOT SEE: a token in a URL PATH (a Slack-style `/services/T…/B…/<token>`), in the
 *   `body`, or in a `comment`. Those are plain props too; put the token in `secret` and reference
 *   it from the template. docs/pbs-notifications.md says the same to the reader.
 * ⛔ A REFUSAL NAMES THE FIELD, NEVER THE VALUE — the message lands in a terminal and a CI log.
 */
import type { FromEnv } from '../secrets/write-only.ts';

/** `{{ secrets.x }}`, `{{secrets.x}}`, `{{ url-encode secrets.x }}` — a reference, not a value. */
const READS_SECRET = /\{\{[^}]*\bsecrets\./;

/** A whole-name match, or one dash/underscore-separated word of the name. */
const CREDENTIAL_WORD =
  /(^|[-_])(api[-_]?key|apikey|key|token|secret|password|passwd|pwd|pass|auth|signature|sig|code)($|[-_])/i;
const CREDENTIAL_HEADER = /^(proxy-authorization|authorization|cookie)$/i;

export const isCredentialName = (name: string): boolean =>
  CREDENTIAL_HEADER.test(name) || CREDENTIAL_WORD.test(name);

const literal = (value: string): boolean => value !== '' && !READS_SECRET.test(value);

/** Plain header values that are credentials by their header's name. `{ fromEnv }` is never one. */
export const literalCredentialHeaders = (
  header: Readonly<Record<string, FromEnv | string>> | undefined,
): string[] =>
  Object.entries(header ?? {})
    .filter(([name, value]) => typeof value === 'string' && isCredentialName(name))
    .filter(([, value]) => literal(value as string))
    .map(([name]) => name)
    .sort();

/**
 * Where a URL carries a literal credential: `userinfo` (a password before the `@`), or the names
 * of credential-shaped query (or fragment) parameters. Parsed by hand, not with `new URL`: a URL here is a
 * TEMPLATE, and `{{ … }}` in the host or the userinfo is not a URL `new URL` will accept.
 */
export const literalCredentialsInUrl = (url: string | undefined): string[] => {
  if (url === undefined) return [];
  const out: string[] = [];
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url)?.[1] ?? '';
  const at = authority.lastIndexOf('@');
  if (at >= 0) {
    const userinfo = authority.slice(0, at);
    const colon = userinfo.indexOf(':');
    if (colon >= 0 && literal(userinfo.slice(colon + 1))) out.push('userinfo');
  }
  // ⚠️ THE FRAGMENT TOO: it is never sent, but it is still a prop — and so still in state.
  const params = url.replace(/^[^?#]*/, '');
  for (const pair of params.split(/[?&#]/)) {
    const eq = pair.indexOf('=');
    const name = eq < 0 ? pair : pair.slice(0, eq);
    if (eq >= 0 && isCredentialName(name) && literal(pair.slice(eq + 1))) out.push(`?${name}`);
  }
  return out;
};
