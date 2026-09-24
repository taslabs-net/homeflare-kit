/**
 * A best-effort refusal of an inline secret ANYWHERE in a rendered `.container` file — checked
 * from `containerProblems` (container-form.ts), so it runs at plan AND apply time, before anything
 * is written.
 *
 * ⛔ THIS IS NOT A SECRET SCANNER. It cannot prove a value is safe, only refuse the OBVIOUS cases: a
 *   key whose name says what it holds, or a value shaped like a real vendor token. The actual
 *   contract is `EnvironmentFile=` (container-form.ts's header): a secret belongs in a host file an
 *   out-of-band renderer (openbao-agent) maintains, never in a prop, because the WHOLE file is
 *   rendered into a 0644 file (`unit-form.ts` `UNIT_WRITE`) AND persisted unencrypted in Alchemy
 *   state — the same two reasons `Systemd.Unit`'s `content` is never secret. A determined caller can
 *   still name a variable `CFG` and put a token in it; this check is a guardrail against the common
 *   mistake, not a boundary a hostile caller cannot cross.
 * ★ KEY-NAME FIRST, VALUE SECOND. The name check catches the overwhelming majority of real
 *   mistakes (copying a `docker run -e SECRET=...` line verbatim) and has no false-negative risk
 *   from an unfamiliar token format; the value check is defense in depth for a handful of
 *   widely-recognised vendor prefixes, not an attempt at general entropy detection — an entropy
 *   check has enough false positives on ordinary config (long image digests, base64 Caddyfile
 *   snippets) that it would train callers to ignore the refusal.
 * ⛔ CHECKED EVERYWHERE, NOT ONLY `container.environment` — found on adversarial review.
 *   `container.environment` is the field most likely to carry one BY ACCIDENT, and gets the
 *   precise per-key `secretLikeEnvironment` check below with the best error message. But every
 *   other free-text field renders into the SAME 0644 file and the SAME state row: `exec`,
 *   `podmanArgs` (each entry rendered verbatim), and the escape-hatch `unit.lines`/`service.lines`
 *   — a `service.lines` entry can spell a native systemd `Environment=` directly, which never goes
 *   through the typed `container.environment` map at all. `secretLikeLines` below runs the same two
 *   heuristics — value-shape, and an embedded `KEY=VALUE` whose KEY looks like a secret — over every
 *   OTHER rendered line, and `container-form.ts`'s `containerProblems` calls both, so nothing
 *   rendered escapes either check.
 */

/** Case-insensitive: matches the key APPEARING to name a credential, wherever it sits in the name. */
const SECRET_KEY_NAME =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_?KEY|CREDENTIAL|ACCESS_KEY|CLIENT_SECRET|AUTH_?KEY|DSN)/i;

/**
 * A handful of widely-recognised credential value shapes: Bearer/Basic auth headers, common vendor
 * token prefixes (GitHub `ghp_`/`gho_`, GitLab `glpat-`, Slack `xoxb-`/`xoxp-`/…, AWS `AKIA`), and a
 * JWT's `eyJ` base64url header. ⚠️ Not exhaustive — see file header.
 */
const SECRET_VALUE_PREFIX = /^(Bearer\s|Basic\s|sk-|ghp_|gho_|glpat-|xox[baprs]-|AKIA|eyJ)/;
/** The same shapes, but matched ANYWHERE in a longer string — a `podmanArgs`/`exec` line is a whole
 *  command or arg list, not a bare value, so the token can sit mid-string (`... --env=ghp_xxx`). */
const SECRET_VALUE_ANYWHERE = new RegExp(SECRET_VALUE_PREFIX.source.replace(/^\^/, ''));

/** A `KEY=VALUE`-shaped substring whose KEY looks like a secret name, wherever it sits in a line —
 *  catches `-e GITHUB_TOKEN=ghp_xxx` or a raw `service.lines` `Environment=SECRET=xxx`. */
const EMBEDDED_SECRET_ASSIGNMENT = new RegExp(
  `[A-Za-z0-9_]*(?:${SECRET_KEY_NAME.source})[A-Za-z0-9_]*\\s*=\\s*\\S+`,
  'i',
);

/** `-e`/`--env` (and their `=`-joined and glued forms) in `PodmanArgs=`: refused OUTRIGHT, not only
 *  when the value looks secret — this resource already has a dedicated, secret-checked way to set a
 *  container env var (`container.environment`/`container.environmentFile`), so a raw `PodmanArgs=`
 *  env flag is always the wrong tool here, whatever it carries. */
const ENV_FLAG = /^(?:-e|--env)(?:=|$|[A-Za-z_])/;

export const secretLikeEnvironment = (environment: Readonly<Record<string, string>>): string[] => {
  const found: string[] = [];
  for (const [key, value] of Object.entries(environment)) {
    if (SECRET_KEY_NAME.test(key)) {
      found.push(
        `environment key ${JSON.stringify(key)} looks like a secret by its name. Environment= is ` +
          'rendered into a world-readable file and stored in Alchemy state; use environmentFile ' +
          'instead, pointing at a host path a secret renderer maintains.',
      );
    } else if (SECRET_VALUE_PREFIX.test(value)) {
      found.push(
        `environment key ${JSON.stringify(key)}'s value looks like a credential. Environment= is ` +
          'rendered into a world-readable file and stored in Alchemy state; use environmentFile ' +
          'instead, pointing at a host path a secret renderer maintains.',
      );
    }
  }
  return found;
};

/** The same two heuristics as `secretLikeEnvironment`, over any OTHER rendered `[key, value]` line
 *  (`Exec=`, `PodmanArgs=`, and the `unit.lines`/`service.lines` escape hatches) — see file header. */
export const secretLikeLines = (
  lines: readonly (readonly [key: string, value: string])[],
): string[] => {
  const found: string[] = [];
  for (const [key, value] of lines) {
    if (SECRET_VALUE_ANYWHERE.test(value)) {
      found.push(
        `${key}=${JSON.stringify(value)} looks like it carries a credential by its value. This ` +
          'line is rendered into a world-readable file and stored in Alchemy state; use ' +
          'container.environmentFile instead, pointing at a host path a secret renderer maintains.',
      );
    } else if (EMBEDDED_SECRET_ASSIGNMENT.test(value)) {
      found.push(
        `${key}=${JSON.stringify(value)} embeds a KEY=VALUE pair whose key looks like a secret ` +
          'name. This line is rendered into a world-readable file and stored in Alchemy state; use ' +
          'container.environment (checked for secrets) or container.environmentFile instead.',
      );
    }
  }
  return found;
};

/** `PodmanArgs=` entries that try to set a container env var outright — see `ENV_FLAG`'s comment. */
export const podmanArgsProblems = (args: readonly string[]): string[] =>
  args
    .filter((arg) => ENV_FLAG.test(arg))
    .map(
      (arg) =>
        `podmanArgs entry ${JSON.stringify(arg)} sets a container environment variable outside ` +
        'the typed props, which this family never checks for a secret. Use container.environment ' +
        '(checked) or container.environmentFile (for anything secret) instead.',
    );
