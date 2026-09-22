/**
 * The wire format the ssh runner speaks: how an argv becomes one remote `sh` script, and how that
 * script's real exit code comes back. Pure functions, so every quoting and framing rule is tested
 * without opening a connection.
 *
 * ⛔ `ssh host <words>` IS NOT AN EXECVE. ssh joins its trailing arguments with spaces and the
 *   REMOTE LOGIN SHELL parses the result, so an unquoted path with a space, a `$`, a backtick or a
 *   `;` is re-parsed as shell syntax on the other side. Everything therefore goes through
 *   `shellQuote`, and the remote command is always `/bin/sh -c '<script>'` — a POSIX shell named
 *   explicitly, so a csh or fish login shell only ever execs it.
 * ⛔ AN EXIT CODE FROM ssh IS AMBIGUOUS. ssh exits 255 for its own failures (connection refused,
 *   host key changed, auth) and otherwise passes the remote exit code through — and a remote
 *   command may itself exit 255. A runner that read the code alone would report "the file is not
 *   there" for a dropped connection, which is the exact "never infer success from an empty result"
 *   failure. So every script ends by printing its own status on stderr behind a PER-RUNNER NONCE,
 *   and a result without that line is a transport failure, never data.
 * ⚠️ THE NONCE IS NOT DECORATION. Without it a remote program that happens to print the marker on
 *   stderr could claim any exit code it liked; with a fresh random nonce per runner, the only thing
 *   that can produce the line is the script we sent.
 */

/** A script whose work found nothing at the path. ★ Chosen from the 64–113 range sh leaves free. */
export const ABSENT = 66;

/**
 * One argument, safe for a POSIX shell. ⛔ Single quotes, because they quote EVERYTHING; the
 *   `'\''` dance is how a literal quote gets through.
 */
export const shellQuote = (arg: string): string => {
  if (arg.includes('\x00')) throw new Error('ssh: an argument contains NUL');
  return `'${arg.replaceAll("'", `'\\''`)}'`;
};

/** An argv as one shell command line. */
export const quoteArgv = (argv: readonly string[]): string => argv.map(shellQuote).join(' ');

const marker = (nonce: string) => `__HF_RC_${nonce}=`;

/**
 * Wrap a script so its status comes back unambiguously.
 * ⚠️ The leading `\n` matters: a program whose last stderr line has no newline would otherwise glue
 *   itself to the marker and the marker would not be found.
 */
export const frameScript = (script: string, nonce: string): string =>
  `${script}\n__hf=$?\nprintf '\\n${marker(nonce)}%s\\n' "$__hf" >&2\nexit "$__hf"`;

export type Framed = { readonly exitCode: number; readonly stderr: string };

/**
 * The remote exit code and the stderr that belongs to the command, or `undefined` when the marker
 * is absent — which means the script never ran to its end: ssh failed, the connection dropped, or
 * the remote shell could not parse what we sent. ⛔ The caller must treat `undefined` as an error,
 * never as an answer.
 */
export const parseFramed = (stderr: string, nonce: string): Framed | undefined => {
  const at = stderr.lastIndexOf(`\n${marker(nonce)}`);
  if (at < 0) return undefined;
  const digits = /^(\d+)\s*$/.exec(stderr.slice(at + marker(nonce).length + 1));
  if (digits?.[1] === undefined) return undefined;
  return { exitCode: Number(digits[1]), stderr: stderr.slice(0, at) };
};

/**
 * The fixed ssh options, in front of anything a caller adds.
 * ⛔ `BatchMode=yes` — a deploy that stops to ask for a passphrase is the failure "no password
 *   prompts" names, and with BatchMode ssh fails at once instead.
 * ⛔ NOTHING HERE WEAKENS HOST VERIFICATION. No `StrictHostKeyChecking`, no `UserKnownHostsFile`:
 *   the operator's own ssh config and known_hosts decide who the host is, and a changed key stays
 *   a refusal. A runner that turned that off would make a man-in-the-middle a deploy target.
 * ★ `-T`: no pseudo-terminal, so the remote shell's stdout stays the bytes the program wrote.
 */
export const sshArgv = (
  host: string,
  script: string,
  options: { readonly connectTimeoutSec: number; readonly sshArgs?: readonly string[] },
): readonly string[] => {
  if (host === '' || host.startsWith('-')) {
    throw new Error(`ssh: ${JSON.stringify(host)} is not a usable destination`);
  }
  return [
    'ssh',
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${String(options.connectTimeoutSec)}`,
    ...(options.sshArgs ?? []),
    host,
    `/bin/sh -c ${shellQuote(script)}`,
  ];
};
