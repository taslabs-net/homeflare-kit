/**
 * sshSudoRunner over the fake Linux host end to end: writeFileAtomic's exact argv sequence and
 * final bytes/mode/owner, a failed `mv` cleaning up the temp, `removeFile` of an absent path never
 * calling sudo, `checkWrite` never calling sudo, and every logged line carrying no file content.
 */
import { describe, expect, test } from 'bun:test';
import { CHOWN, INSTALL, MKDIR, MV, RM, RMDIR } from './sudo-allowlist.ts';
import { fakeSudoHost } from './fake-sudo.ts';
import { SudoRefusedError } from './sudo-runner.ts';

const SECRET = 'super-secret-config-value=hunter2\n';
const DEST = '/etc/systemd/system/thing.service';

describe('what it claims', () => {
  test('privileged, as the operator: it elevates calls, it is not root', () => {
    const { runner } = fakeSudoHost();
    expect(runner.privileged).toBe(true);
    expect(runner.effectiveUid()).toBe(1000);
  });
});

describe('writeFileAtomic under a prefix', () => {
  test('install into a derived temp, then mv onto the path — exact argv, and the bytes land', async () => {
    const { fake, logs, privileged, runner } = fakeSudoHost();
    await runner.writeFileAtomic(DEST, new TextEncoder().encode(SECRET), {
      gid: 0,
      mode: 0o644,
      uid: 0,
    });

    const calls = privileged();
    expect(calls).toHaveLength(2);
    const [install, mv] = calls;
    expect(install?.[0]).toBe(INSTALL);
    expect(install?.slice(1, 3)).toEqual(['-m', '0644']);
    // install: [-m, mode, -T, --, staged, temp] — the temp is derived FROM dest, in its directory.
    expect(install?.at(-1)).toMatch(
      /^\/etc\/systemd\/system\/\.thing\.service\.hf-[0-9a-f]{12}\.tmp$/,
    );
    expect(mv?.[0]).toBe(MV);
    expect(mv?.slice(1, 3)).toEqual(['-f', '-T']);
    // mv: [-f, -T, --, temp, dest] — its source is exactly install's target.
    expect(mv?.at(-2)).toBe(install?.at(-1));
    expect(mv?.at(-1)).toBe(DEST);

    const file = fake.files.get(DEST);
    expect(file?.mode).toBe(0o644);
    expect(file?.uid).toBe(0);
    expect(new TextDecoder().decode(file?.bytes)).toBe(SECRET);
    // ⛔ Bytes never travel through argv or the log.
    expect(logs.some((line) => line.includes('hunter2'))).toBe(false);
    for (const line of logs) expect(line.startsWith('homeflare/linux sudo -n ')).toBe(true);
    // No temp file left behind, and the staging directory is gone too.
    expect([...fake.files.keys()].some((path) => path.includes('.hf-'))).toBe(false);
    expect([...fake.dirs.keys()].some((path) => path.startsWith('/tmp/hf-sudo-'))).toBe(false);
  });

  test('a failed mv removes the temp it just installed, then still throws', async () => {
    const { fake, privileged, runner, state } = fakeSudoHost();
    state.mvFailure = { exitCode: 1, stderr: 'mv: simulated failure', stdout: '' };
    await expect(
      runner.writeFileAtomic(DEST, new TextEncoder().encode('x'), { mode: 0o644 }),
    ).rejects.toThrow('simulated failure');

    const calls = privileged();
    expect(calls.map((c) => c[0])).toEqual([INSTALL, MV, RM]);
    // ★ rm's argument is install's own temp target — the exact path mv failed to move.
    expect(calls[2]?.at(-1)).toBe(calls[0]?.at(-1));
    expect(fake.files.has(DEST)).toBe(false);
    expect([...fake.files.keys()].some((path) => path.includes('.hf-'))).toBe(false);
    expect([...fake.dirs.keys()].some((path) => path.startsWith('/tmp/hf-sudo-'))).toBe(false);
  });
});

describe('checkWrite', () => {
  test('never calls sudo, under a prefix or outside one', async () => {
    const { runner, logs, privileged } = fakeSudoHost();
    await runner.checkWrite?.(DEST, { mode: 0o644, uid: 0, gid: 0 });
    await expect(runner.checkWrite?.('/opt/elsewhere/x', { mode: 0o644 })).resolves.toBeUndefined();
    expect(privileged()).toEqual([]);
    expect(logs).toEqual([]);
  });
});

describe('removeFile', () => {
  test('an absent path under a prefix is a no-op, no sudo', async () => {
    const { privileged, runner } = fakeSudoHost();
    await runner.removeFile('/etc/systemd/system/absent.service');
    expect(privileged()).toEqual([]);
  });

  test('a present file under a prefix is removed with rm -f --', async () => {
    const { fake, privileged, runner } = fakeSudoHost();
    fake.files.set(DEST, { bytes: new Uint8Array(), gid: 0, kind: 'file', mode: 0o644, uid: 0 });
    await runner.removeFile(DEST);
    expect(privileged()).toEqual([[RM, '-f', '--', DEST]]);
    expect(fake.files.has(DEST)).toBe(false);
  });
});

describe('exec routing', () => {
  test('mkdir/chown under a prefix run as root with absolute argv', async () => {
    const { fake, privileged, runner } = fakeSudoHost();
    await runner.exec(['mkdir', '-m', '750', '--', '/usr/local/bin/sub']);
    await runner.exec(['chown', '900:60', '--', '/usr/local/bin/sub']);
    expect(privileged()).toEqual([
      [MKDIR, '-m', '750', '--', '/usr/local/bin/sub'],
      [CHOWN, '900:60', '--', '/usr/local/bin/sub'],
    ]);
    expect(fake.modes.get('/usr/local/bin/sub')).toEqual({ gid: 60, mode: 0o750, uid: 900 });
  });

  test('rmdir under a prefix runs as root', async () => {
    const { fake, privileged, runner } = fakeSudoHost({ '/usr/local/bin/sub': 0 });
    await runner.exec(['rmdir', '--', '/usr/local/bin/sub']);
    expect(privileged()).toEqual([[RMDIR, '--', '/usr/local/bin/sub']]);
    expect(fake.dirs.has('/usr/local/bin/sub')).toBe(false);
  });

  test('mkdir outside every prefix runs as the operator, no sudo', async () => {
    const { privileged, runner } = fakeSudoHost({ '/opt': 0 });
    const result = await runner.exec(['mkdir', '-m', '750', '--', '/opt/elsewhere']);
    expect(result.exitCode).toBe(0);
    expect(privileged()).toEqual([]);
  });

  test('a sudo argv is refused before anything runs', async () => {
    await expect(fakeSudoHost().runner.exec(['sudo', 'true'])).rejects.toBeInstanceOf(
      SudoRefusedError,
    );
  });
});
