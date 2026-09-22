/**
 * The Caddyfile half of "protect this route with Cloudflare Access": a `forward_auth` block
 * pointing at a verifier that speaks the contract in `@homeflare/cloudflare/access-auth`.
 *
 * ★ A BUILDER, NOT A RESOURCE. Nothing here is created, adopted or destroyed — it is Caddyfile
 *   TEXT that a caller drops into the `caddyfile` prop of a `CaddyConfig` / `caddyWithFile()`.
 *   A resource would own a fragment of a config that `CaddyConfig` already owns whole, and two
 *   owners of one file is the drift this package exists to prevent.
 *
 * ⛔ WHY IT IS GENERATED RATHER THAN COPY-PASTED. Every field below is load-bearing, and the
 *   failure mode of getting one wrong is a route that looks protected and is not:
 *   · a missing `copy_headers` — the upstream gets no identity and either breaks or, worse,
 *     falls back to trusting a header the CLIENT set;
 *   · the verifier on anything but loopback — the JWT check becomes advisory, because the
 *     verifier itself can be reached and answered around;
 *   · `uri` pointing at a path the verifier does not route — every request 404s, which is
 *     non-2xx, which Caddy correctly treats as a denial, so the symptom is "Access is broken".
 */

/** ⚠️ Kept in step with `granted()` in @homeflare/cloudflare/access-auth. */
const DEFAULT_COPY_HEADERS = ['X-Access-Email', 'X-Access-Sub'] as const;

export interface AccessForwardAuthProps {
  /**
   * Where the verifier listens, e.g. `127.0.0.1:9101`.
   * ⛔ LOOPBACK OR A UNIX SOCKET. See `verifierProblems` — a routable verifier is not a check.
   */
  readonly verifier: string;
  /** The path the verifier answers on. @default '/access/verify' */
  readonly uri?: string;
  /**
   * Response headers copied from the verifier onto the upstream request.
   * @default ['X-Access-Email', 'X-Access-Sub']
   */
  readonly copyHeaders?: readonly string[];
  /** Lines placed inside the route BEFORE `forward_auth` — typically the upstream. */
  readonly body?: readonly string[];
  /** Indent applied to every emitted line. @default '\t' */
  readonly indent?: string;
}

/**
 * Problems that make a `forward_auth` block unsafe rather than merely wrong.
 *
 * ⛔ THE LOOPBACK RULE IS THE IMPORTANT ONE. If the verifier answers on a routable address, an
 *   attacker reaches the UPSTREAM directly and never involves Caddy at all — or reaches the
 *   verifier and reads identities out of it. The whole design assumes both the verifier and the
 *   upstream are bound to loopback and that Caddy is the only way in.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * The host part of a Caddy upstream address.
 *
 * ⚠️ NOT `split(':')[0]`. That returns `'['` for `[::1]:9101`, so an IPv6 loopback verifier
 *   was rejected as routable — caught by the test below, not by reading the code.
 */
const hostOf = (verifier: string): string => {
  const address = verifier.replace(/^https?:\/\//, '');
  if (address.startsWith('unix/')) return 'unix';

  // Bracketed IPv6 keeps its brackets; the port is whatever follows the closing one.
  if (address.startsWith('[')) return address.slice(0, address.indexOf(']') + 1);

  const colon = address.indexOf(':');
  return colon === -1 ? address : address.slice(0, colon);
};

export const verifierProblems = (verifier: string): string[] => {
  const found: string[] = [];
  const host = hostOf(verifier.trim());

  if (verifier.trim() === '') found.push('verifier is empty');
  else if (host !== 'unix' && !LOOPBACK.has(host)) {
    found.push(
      `verifier must be loopback or a unix socket, got ${verifier} — a routable verifier can be bypassed`,
    );
  }
  return found;
};

/**
 * Render the `forward_auth` block for one protected route.
 *
 * ```ts
 * const caddyfile = `vnc.example.com {
 * ${accessForwardAuth({ verifier: '127.0.0.1:9101', body: ['reverse_proxy 127.0.0.1:6080'] })}
 * }
 * `;
 * ```
 *
 * ⛔ ONE VERIFIER ENDPOINT PER ACCESS APPLICATION. The AUD is fixed in the verifier's own config,
 *   never carried in this request — so two applications mean two `uri`s (or two verifiers), not
 *   one endpoint told which app to check. An AUD the request can influence is the vulnerability.
 *
 * ⚠️ `forward_auth` COPIES THE VERIFIER'S RESPONSE BACK TO THE CLIENT on any non-2xx, which is why
 *   the verifier answers a bare 401 with no body: whatever it returns is what the browser sees.
 */
export const accessForwardAuth = (props: AccessForwardAuthProps): string => {
  const problems = verifierProblems(props.verifier);
  if (problems.length > 0) throw new Error(`accessForwardAuth: ${problems.join('; ')}`);

  const indent = props.indent ?? '\t';
  const uri = props.uri ?? '/access/verify';
  const headers = props.copyHeaders ?? DEFAULT_COPY_HEADERS;

  const lines = [
    ...(props.body ?? []),
    `forward_auth ${props.verifier} {`,
    `${indent}uri ${uri}`,
    // ⚠️ `copy_headers` with a block, one field per line: the single-line form is also valid but
    //   diffs badly, and this list is exactly where a security review needs to read a change.
    `${indent}copy_headers {`,
    ...headers.map((header) => `${indent}${indent}${header}`),
    `${indent}}`,
    '}',
  ];

  return lines.map((line) => `${indent}${line}`).join('\n');
};
