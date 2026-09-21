/**
 * HostFile's lifecycle against the fake host (no real writes), plus its validation.
 */
import { describe, expect, test } from 'bun:test';
import { fakeRunner } from './fake-runner.ts';
import { type HostFileProps, fileProblems } from './host-file-form.ts';
import { deleteFile, diffFile, readFileAttributes, reconcileFile } from './host-file-lifecycle.ts';

const PATH = '/etc/example/app.conf';
const file: HostFileProps = { content: 'listen = 127.0.0.1:9000\n', path: PATH };

const host = (euid = 0) =>
  fakeRunner({
    dirs: { '/etc/example': 0, '/Users/someone/cfg': 501 },
    euid,
    groups: { staff: 20, wheel: 0 },
    users: {
      root: { gid: 0, home: '/var/root', uid: 0 },
      someone: { gid: 20, home: '/Users/someone', uid: 501 },
    },
  });

const writeCount = (calls: string[][]) => calls.filter((call) => call[0] === 'write').length;

describe('create and read back', () => {
  test('writes the content with the default mode 0644 and returns what is on disk', async () => {
    const fake = host();
    const attrs = await reconcileFile(fake.runner, file);
    expect(attrs).toMatchObject({ mode: 0o644, path: PATH, size: file.content.length, uid: 0 });
    expect(new TextDecoder().decode(fake.files.get(PATH)?.bytes)).toBe(file.content);
    expect(await readFileAttributes(fake.runner, PATH)).toEqual(attrs);
  });

  test('owner and group resolve by name or by id', async () => {
    const fake = host();
    const attrs = await reconcileFile(fake.runner, {
      ...file,
      group: 'staff',
      mode: 0o640,
      owner: 'someone',
    });
    expect(attrs).toMatchObject({ gid: 20, mode: 0o640, uid: 501 });
    const byId = await reconcileFile(fake.runner, { ...file, group: 0, owner: '0' });
    expect(byId).toMatchObject({ gid: 0, uid: 0 });
  });

  test('an already-matching file is not rewritten', async () => {
    const fake = host();
    await reconcileFile(fake.runner, file);
    await reconcileFile(fake.runner, file);
    expect(writeCount(fake.calls)).toBe(1);
  });
});

describe('diff', () => {
  test('noop, then update on content, mode or owner drift', async () => {
    const fake = host();
    const output = await reconcileFile(fake.runner, { ...file, owner: 'root' });
    expect(await diffFile(fake.runner, { ...file, owner: 'root' }, output)).toEqual({
      action: 'noop',
    });
    expect(await diffFile(fake.runner, { ...file, content: 'x\n' }, output)).toEqual({
      action: 'update',
    });
    expect(await diffFile(fake.runner, { ...file, mode: 0o600 }, output)).toEqual({
      action: 'update',
    });
    expect(await diffFile(fake.runner, { ...file, owner: 'someone' }, output)).toEqual({
      action: 'update',
    });
    const entry = fake.files.get(PATH);
    if (entry === undefined) throw new Error('no file');
    fake.files.set(PATH, { ...entry, mode: 0o666 });
    expect(await diffFile(fake.runner, { ...file, owner: 'root' }, output)).toEqual({
      action: 'update',
    });
  });

  test('a file deleted behind our back is an update', async () => {
    const fake = host();
    const output = await reconcileFile(fake.runner, file);
    fake.files.delete(PATH);
    expect(await diffFile(fake.runner, file, output)).toEqual({ action: 'update' });
  });

  test('a new path is a create-before-delete replace', async () => {
    const fake = host();
    const output = await reconcileFile(fake.runner, file);
    expect(
      await diffFile(fake.runner, { ...file, path: '/etc/example/other.conf' }, output),
    ).toEqual({ action: 'replace' });
  });
});

describe('refusals', () => {
  test('chown to another user as a non-root deployer', async () => {
    const fake = host(501);
    await expect(
      reconcileFile(fake.runner, { ...file, owner: 'root', path: '/Users/someone/cfg/a' }),
    ).rejects.toThrow('only root may chown');
  });

  test('a symlink or a directory at the path is never replaced', async () => {
    const fake = host();
    fake.files.set(PATH, { bytes: new Uint8Array(), gid: 0, kind: 'symlink', mode: 0o755, uid: 0 });
    await expect(reconcileFile(fake.runner, file)).rejects.toThrow('is a symlink');
    await expect(reconcileFile(fake.runner, { ...file, path: '/etc/example' })).rejects.toThrow(
      'is a directory',
    );
  });

  test('an unknown owner or group', async () => {
    const fake = host();
    await expect(reconcileFile(fake.runner, { ...file, owner: 'nobody-here' })).rejects.toThrow(
      'no user',
    );
    await expect(reconcileFile(fake.runner, { ...file, group: 'nogroup' })).rejects.toThrow(
      'no group',
    );
  });

  test('a missing parent directory surfaces as the error it is', async () => {
    await expect(reconcileFile(host().runner, { ...file, path: '/nowhere/x' })).rejects.toThrow(
      'ENOENT',
    );
  });

  test.each([
    ['a relative path', { path: 'etc/x' }, 'absolute'],
    ['a dot-dot segment', { path: '/etc/../x' }, 'normalised'],
    ['a trailing slash', { path: '/etc/x/' }, 'normalised'],
    ['a double slash', { path: '/etc//x' }, 'normalised'],
    ['a mode above 0o7777', { mode: 0o10000 }, 'mode'],
    ['a bad owner name', { owner: 'a b' }, 'not a valid user'],
    ['a negative gid', { group: -1 }, 'non-negative'],
    // ⚠️ Split so gitleaks' private-key rule does not flag the fixture (secret-tripwire.test.ts).
    ['a private key', { content: `-----BEGIN EC ${'PRIVATE'} KEY-----\n` }, 'openbao-agent'],
  ])('%s', (_name, patch, message) => {
    expect(fileProblems({ ...file, ...patch } as HostFileProps).join('\n')).toContain(message);
  });
});

describe('delete', () => {
  test('removes the file and is idempotent', async () => {
    const fake = host();
    const output = await reconcileFile(fake.runner, file);
    await deleteFile(fake.runner, output);
    expect(fake.files.has(PATH)).toBe(false);
    await deleteFile(fake.runner, output);
  });

  test('refuses once the path has become something other than a file', async () => {
    const fake = host();
    const output = await reconcileFile(fake.runner, file);
    fake.files.set(PATH, { bytes: new Uint8Array(), gid: 0, kind: 'symlink', mode: 0o755, uid: 0 });
    await expect(deleteFile(fake.runner, output)).rejects.toThrow('not removing');
  });
});
