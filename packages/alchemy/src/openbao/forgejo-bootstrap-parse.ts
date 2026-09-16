/**
 * Reading what the Forgejo CLI prints, for the forgejo-provision bootstrap (forgejo-bootstrap.ts).
 *
 * ★ PURE, SO THE ONE PART THAT TOUCHES THE PASSWORD IS TESTED WITHOUT ONE. Every format below was
 *   read off the running 16.0.3 daemon or its source on 2026-09-14, not assumed.
 */

/** Where the mini's Forgejo keeps its state (hosts/macmini/modules/forgejo.nix:235, app.ini:14). */
export const FORGEJO_WORK_PATH = '/opt/homeflare/forgejo';
/** The file the launchd runner renders at every start (forgejo.nix:78). Readable by tim, who runs Forgejo. */
export const FORGEJO_CONFIG = `${FORGEJO_WORK_PATH}/custom/conf/app.ini`;

/**
 * The binary of the RUNNING server, so the CLI writes the same schema as the daemon serving it.
 *
 * ★ MEASURED: `ps -axo command` shows
 *   `/nix/store/<hash>-forgejo-16.0.3/bin/forgejo web --work-path /opt/homeflare/forgejo`. A
 *   `forgejo` found on PATH could be a different version from the one holding the database.
 */
export const runningForgejoBinary = (psCommands: string): string | undefined => {
  for (const line of psCommands.split('\n')) {
    const [binary, subcommand] = line.trim().split(/\s+/);
    if (
      subcommand === 'web' &&
      binary !== undefined &&
      /^\/nix\/store\/[^/]+-forgejo-[\d.]+\/bin\/forgejo$/.test(binary)
    ) {
      return binary;
    }
  }
  return undefined;
};

/**
 * Usernames from `forgejo admin user list`: a tabwriter table whose header is
 * `ID Username Email IsActive IsAdmin 2FA` (measured, six columns).
 *
 * ⛔ AN UNEXPECTED HEADER THROWS. Parsing a changed table as "no such user" would let the bootstrap
 *   create over an account it failed to see.
 */
export const usernamesFrom = (table: string): string[] => {
  const rows = table
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row !== '');
  const header = rows[0]?.split(/\s+/) ?? [];
  if (header[0] !== 'ID' || header[1] !== 'Username') {
    throw new Error(
      `forgejo admin user list printed an unexpected header: ${rows[0] ?? '(nothing)'}`,
    );
  }
  return rows.slice(1).map((row) => row.split(/\s+/)[1] ?? '');
};

/** What `admin user create --random-password` printed on stdout. */
export type CreateOutput = {
  readonly created: boolean;
  /** ⛔ Never logged, never returned past the one OpenBao write. */
  readonly password: string | undefined;
  /** Every other non-empty stdout line, safe to echo. */
  readonly rest: readonly string[];
};

/**
 * ★ THE TWO LINES, FROM forgejo v16.0 cmd/admin_user_create.go:
 *     generated random password is '%s'
 *     New user '%s' has been successfully created!
 * ⚠️ THE PATTERN IS GREEDY TO THE LAST QUOTE ON PURPOSE. Forgejo's generator can draw a `'` when
 *   PASSWORD_COMPLEXITY includes `spec`, and a lazy match would silently store a truncated password
 *   that no mint could ever use. The generator never draws a newline, so one line is one password.
 */
export const readCreateOutput = (stdout: string, username: string): CreateOutput => {
  let password: string | undefined;
  let created = false;
  const rest: string[] = [];
  for (const line of stdout.split('\n')) {
    const generated = /^generated random password is '(.*)'$/.exec(line);
    if (generated !== null) {
      password = generated[1];
      continue;
    }
    if (line === `New user '${username}' has been successfully created!`) created = true;
    if (line.trim() !== '') rest.push(line);
  }
  return { created, password, rest };
};

/** The last few lines of a CLI's stderr, for a failure message. Forgejo prints no secret there. */
export const tailOf = (text: string, lines = 5): string =>
  text.trim().split('\n').slice(-lines).join(' | ') || '(no output)';
