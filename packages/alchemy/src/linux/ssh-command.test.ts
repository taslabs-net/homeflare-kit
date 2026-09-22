/**
 * The ssh wire format, with no connection: quoting, framing, and the fail-closed rule that a
 * result without the framing marker is never read as data.
 */
import { describe, expect, test } from 'bun:test';
import { ABSENT, frameScript, parseFramed, quoteArgv, shellQuote, sshArgv } from './ssh-command.ts';
import { parseStat, statScript, writeScript } from './ssh-scripts.ts';

const NONCE = 'a1b2c3d4';

describe('quoting', () => {
  test('shell metacharacters survive as data', () => {
    for (const arg of ['a b', '$HOME', '`id`', 'x;rm -rf /', "it's", 'new\nline', '*']) {
      expect(shellQuote(arg)).toMatch(/^'.*'$/s);
    }
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  test('NUL is refused rather than truncated by the shell', () => {
    expect(() => shellQuote('a\u0000b')).toThrow(/NUL/);
  });

  test('an argv becomes one command line', () => {
    expect(quoteArgv(['systemctl', 'show', 'a b.service'])).toBe(
      `'systemctl' 'show' 'a b.service'`,
    );
  });
});

describe('framing', () => {
  test('the remote status comes back behind the nonce, and its stderr is clean', () => {
    const stderr = `boom\n\n__HF_RC_${NONCE}=3\n`;
    // ★ The command's own trailing newline is the command's; only the marker line is removed.
    expect(parseFramed(stderr, NONCE)).toEqual({ exitCode: 3, stderr: 'boom\n' });
  });

  test('a result with no marker is not an answer', () => {
    // ⛔ This is the whole point: ssh exit 255 with empty output must not read as "not found".
    expect(parseFramed('', NONCE)).toBeUndefined();
    expect(
      parseFramed('ssh: connect to host port 22: Connection refused\n', NONCE),
    ).toBeUndefined();
  });

  test('a marker under another nonce cannot speak for this runner', () => {
    expect(parseFramed(`\n__HF_RC_deadbeef=0\n`, NONCE)).toBeUndefined();
  });

  test('a program that prints the marker text itself does not win — the last one is ours', () => {
    const stderr = `pretend: __HF_RC_${NONCE}=0\n\n__HF_RC_${NONCE}=7\n`;
    expect(parseFramed(stderr, NONCE)?.exitCode).toBe(7);
  });

  test('the frame ends by echoing the status and exiting with it', () => {
    const framed = frameScript('true', NONCE);
    expect(framed).toContain('__hf=$?');
    expect(framed).toContain(`__HF_RC_${NONCE}=%s`);
    expect(framed.endsWith('exit "$__hf"')).toBe(true);
  });

  test('a script that exits still reports — the subshell is load-bearing', async () => {
    /**
     * 🔴 MEASURED 2026-09-22 against a live host: without the subshell, `statScript`'s
     *   `else exit 66` left the shell before the marker printed, and a missing file came back as
     *   a transport failure. This runs the real framing through a real /bin/sh.
     */
    const script = frameScript(statScript('/definitely-not-here-hf'), NONCE);
    const shell = Bun.spawn(['/bin/sh', '-c', script], { stderr: 'pipe', stdout: 'pipe' });
    const stderr = await new Response(shell.stderr).text();
    expect(parseFramed(stderr, NONCE)?.exitCode).toBe(ABSENT);
  });
});

describe('the ssh invocation', () => {
  const argv = sshArgv('somewhere', 'true', { connectTimeoutSec: 10 });

  test('never prompts and never weakens host verification', () => {
    expect(argv).toContain('BatchMode=yes');
    expect(argv.join(' ')).not.toContain('StrictHostKeyChecking');
    expect(argv.join(' ')).not.toContain('UserKnownHostsFile');
  });

  test('names a POSIX shell rather than trusting the login shell', () => {
    expect(argv.at(-1)?.startsWith("/bin/sh -c '")).toBe(true);
  });

  test('a destination that could be read as an option is refused', () => {
    expect(() => sshArgv('-oProxyCommand=evil', 'true', { connectTimeoutSec: 10 })).toThrow();
  });
});

describe('the file scripts', () => {
  test('stat asks about the link, not its target, and says so for a dangling one', () => {
    const script = statScript('/etc/thing');
    expect(script).toContain("[ -e '/etc/thing' ] || [ -L '/etc/thing' ]");
    expect(script).not.toContain('stat -L');
  });

  test('the write stages, chowns, chmods, then renames — and cleans up on every failure', () => {
    const script = writeScript('/etc/a.conf', '/etc/.a.conf.tmp', { gid: 0, mode: 0o640, uid: 0 });
    const steps = script.split('\n');
    expect(steps[0]).toBe('set -C');
    expect(steps[1]).toBe('umask 077');
    expect(script.indexOf('chown')).toBeLessThan(script.indexOf('chmod'));
    expect(script).toContain("chmod 640 -- '/etc/.a.conf.tmp'");
    expect(script).toContain("mv -f -- '/etc/.a.conf.tmp' '/etc/a.conf'");
    expect(script.match(/rm -f --/g)).toHaveLength(4);
  });

  test('a declared owner with no group never becomes the user’s login group', () => {
    expect(writeScript('/a', '/t', { mode: 0o644, uid: 42 })).toContain("chown 42 -- '/t'");
    expect(writeScript('/a', '/t', { gid: 7, mode: 0o644 })).toContain("chown :7 -- '/t'");
    expect(writeScript('/a', '/t', { mode: 0o644 })).not.toContain('chown');
  });
});

describe('stat output', () => {
  test('the measured shape parses, file type from the raw mode', () => {
    // MEASURED 2026-09-22 on Debian 13: `/etc/hostname` → `81a4 644 0 0 4`.
    expect(parseStat('81a4 644 0 0 4\n')).toEqual({
      gid: 0,
      kind: 'file',
      mode: 0o644,
      size: 4,
      uid: 0,
    });
    expect(parseStat('41ed 755 0 0 4096')?.kind).toBe('directory');
    expect(parseStat('a1ff 777 0 0 11')?.kind).toBe('symlink');
    expect(parseStat('c000 666 0 0 0')?.kind).toBe('other');
  });

  test('setuid bits come from the permission field, not the raw mode', () => {
    expect(parseStat('89ed 4755 0 0 1')?.mode).toBe(0o4755);
  });

  test('anything else is undefined, so the runner can refuse instead of guessing', () => {
    expect(parseStat('stat: cannot statx')).toBeUndefined();
    expect(parseStat('')).toBeUndefined();
  });
});
