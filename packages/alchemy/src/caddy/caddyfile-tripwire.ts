/**
 * A tripwire for the obvious ways a secret ends up in a CaddyConfig's `caddyfile` prop.
 *
 * ⛔ WHY IT EXISTS. Alchemy stores every prop UNENCRYPTED in its state store and prints it in plan
 *   diffs (the reason launchd's secret-tripwire.ts and the metadata-only OpenBao families exist).
 *   The whole Caddyfile is one prop, so a token typed into it is a token in state.
 * ★ THE ALTERNATIVE, NAMED IN EVERY REFUSAL: a RUNTIME placeholder, which Caddy resolves in its own
 *   process and which therefore never enters the Caddyfile, the state, the adapted JSON or
 *   `autosave.json` (caddyserver/caddy v2.11.4 replacer.go):
 *   · `{env.NAME}` — the Caddy process's environment; start Caddy with `--envfile <path>` where a
 *     secret renderer (openbao-agent) writes that file. A rotated value needs a Caddy restart.
 *   · `{file./path}` — the file's contents, trailing newline trimmed, read when the placeholder is
 *     evaluated; the renderer writes the file.
 * ⚠️ `{$NAME}` IS NOT ONE OF THEM. It is substituted at ADAPT time (caddyfile/parse.go
 *   replaceEnvVars), so the value lands in the adapted JSON — readable at `GET /config/` and
 *   written to `autosave.json`. It is not refused (the prop holds only the name), but it is worse.
 *   `{$NAME:default}` is different: the default IS in the prop, and is checked as a literal.
 * ⚠️ A TRIPWIRE, NOT A SCANNER. It catches the names and shapes people actually type; a secret in
 *   an innocent-looking argument passes. Nothing here makes a secret safe to declare.
 */
import { PRIVATE_KEY } from '../launchd/secret-tripwire.ts';

const ALTERNATIVE =
  'props are stored unencrypted in Alchemy state. Use a runtime placeholder instead: {env.NAME} ' +
  '(Caddy started with --envfile <file a secret renderer writes>) or {file./path/to/secret}.';

/** A subdirective whose whole name says "my argument is the secret". `*_file` never matches. */
const SECRET_WORD =
  /^(?:token|api_token|auth_token|access_token|secret|client_secret|shared_secret|secret_key|password|passwd|passphrase|api_key|apikey|private_key|mac_key|hmac_key)$/i;

/** Directives whose second argument is a DNS provider's credential: `dns cloudflare <token>`. */
const DNS_DIRECTIVE = /^(?:dns|acme_dns)$/;

const HEADER_DIRECTIVE = /^(?:header|header_up|header_down|request_header)$/;
const CREDENTIAL_HEADER =
  /^[+-]?(?:authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-vault-token)$/i;

/** Shapes that are a credential wherever they appear. The label is what the refusal says. */
const SHAPES: readonly (readonly [RegExp, string])[] = [
  [/^(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})$/, 'a GitHub token'],
  [/^(?:AKIA|ASIA)[0-9A-Z]{16}$/, 'an AWS access key id'],
  [/^xox[abposr]-[A-Za-z0-9-]{10,}$/, 'a Slack token'],
  [/^sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}$/, 'an API secret key'],
  [/^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/, 'a JWT'],
  // ★ basic_auth replaces placeholders in the hash at provision time (caddyauth/basicauth.go
  //   Provision), so `{env.ADMIN_HASH}` works and a literal hash never needs to be declared.
  [/^\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}$/, 'a bcrypt password hash'],
  [/^\$argon2(?:id|i|d)\$/, 'an argon2 password hash'],
];

const PLACEHOLDER = /\{[^{}\s]+\}/g;
const AUTH_SCHEME = /^(?:bearer|basic|token|digest)$/i;

/**
 * ⛔ `{$NAME:default}` IS A LITERAL. Caddy splices the default in at ADAPT time whenever NAME is
 *   unset (caddyfile/parse.go replaceEnvVars: SplitN on `:`), so a secret typed as the default is
 *   in the prop, the state and the adapted JSON. MEASURED 2026-09-21 on a throwaway Caddy 2.11.4:
 *   `respond "{$UNSET:literal-default}"` adapted to the body `literal-default`. So each line is
 *   checked as Caddy sees it with every such variable unset. The RUNTIME replacer has no default
 *   syntax (replacer.go looks the whole key up), so `{env.X}` stays the safe form.
 */
const ENV_DEFAULT = /\{\$[^{}\s:]*:([^}]*)\}/g;
const withDefaults = (line: string): string => line.replace(ENV_DEFAULT, '$1');

/** One line's tokens: whitespace-separated, "double-quoted" and `backquoted` kept whole, # comments dropped. */
export const tokensOf = (line: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (quote !== undefined) {
      if (char === '\\' && quote === '"' && index + 1 < line.length) {
        index += 1;
        current += line[index] ?? '';
      } else if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === '`') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current !== '') tokens.push(current);
      current = '';
    } else if (char === '#' && current === '') {
      break; // a comment starts only at the beginning of a token (caddyfile lexer)
    } else current += char;
  }
  if (current !== '') tokens.push(current);
  return tokens;
};

/**
 * True when nothing but placeholders (and an auth scheme word) is left of these tokens.
 * ⚠️ A bare `{` / `}` is a block brace, not a value: `dns cloudflare {` opens a block whose
 *   `api_token` line is checked on its own.
 */
const placeholderOnly = (tokens: readonly string[]): boolean =>
  tokens
    .flatMap((token) => token.replace(PLACEHOLDER, ' ').split(/\s+/))
    .filter((part) => part !== '' && part !== '{' && part !== '}' && !AUTH_SCHEME.test(part))
    .length === 0;

const lineProblems = (tokens: readonly string[], where: string): string[] => {
  const [first = '', second] = tokens;
  const found: string[] = [];
  if (SECRET_WORD.test(first) && tokens.length > 1 && !placeholderOnly(tokens.slice(1))) {
    found.push(`${where}: \`${first}\` has a literal value`);
  }
  if (DNS_DIRECTIVE.test(first) && tokens.length > 2 && !placeholderOnly(tokens.slice(2))) {
    found.push(`${where}: \`${first} ${second ?? ''}\` has a literal credential`);
  }
  if (HEADER_DIRECTIVE.test(first)) {
    const at = tokens.findIndex((token, index) => index > 0 && CREDENTIAL_HEADER.test(token));
    if (at !== -1 && tokens.length > at + 1 && !placeholderOnly(tokens.slice(at + 1))) {
      found.push(`${where}: \`${first} ${tokens[at] ?? ''}\` sets a literal credential`);
    }
  }
  for (const token of tokens) {
    const shape = SHAPES.find(([pattern]) => pattern.test(token));
    // ⛔ Never echo the token: if it IS a secret, the refusal would print it.
    if (shape !== undefined) found.push(`${where}: holds what looks like ${shape[1]}`);
  }
  return found;
};

/** Refusals for a Caddyfile's text. Empty means nothing tripped. */
export const caddyfileSecretProblems = (caddyfile: string): string[] => {
  const found: string[] = [];
  if (PRIVATE_KEY.test(caddyfile)) found.push('the Caddyfile holds a PEM private key');
  for (const [index, line] of caddyfile.split('\n').entries()) {
    found.push(...lineProblems(tokensOf(withDefaults(line)), `line ${String(index + 1)}`));
  }
  return found.map((problem) => `${problem}: ${ALTERNATIVE}`);
};
