/**
 * The real runner, confined to a fresh temp directory. It never runs launchctl and never writes
 * outside `mkdtemp`; the only programs it spawns are echo/false and a read-only user lookup.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localRunner } from './local-runner.ts';

const runner = localRunner();
let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hf-local-runner-'));
});
afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe('writeFileAtomic', () => {
  test('writes the bytes with the declared mode and leaves no temp file behind', async () => {
    const path = join(dir, 'a.conf');
    await runner.writeFileAtomic(path, bytes('one\n'), { mode: 0o640 });
    expect(await Bun.file(path).text()).toBe('one\n');
    expect((await stat(path)).mode & 0o7777).toBe(0o640);
    expect(await readdir(dir)).toEqual(['a.conf']);
  });

  test('replaces by rename — a new inode, never an in-place rewrite', async () => {
    const path = join(dir, 'a.conf');
    await runner.writeFileAtomic(path, bytes('one\n'), { mode: 0o644 });
    const before = (await stat(path)).ino;
    await runner.writeFileAtomic(path, bytes('two\n'), { mode: 0o644 });
    expect(await Bun.file(path).text()).toBe('two\n');
    expect((await stat(path)).ino).not.toBe(before);
  });

  test('a missing parent directory fails and creates nothing', async () => {
    await expect(
      runner.writeFileAtomic(join(dir, 'no/such/a'), bytes('x'), { mode: 0o644 }),
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  test.skipIf(process.geteuid?.() === 0)('a refused chown cleans up its temp file', async () => {
    const path = join(dir, 'owned');
    await expect(
      runner.writeFileAtomic(path, bytes('x'), { mode: 0o644, uid: 0 }),
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  test('chowning to yourself is allowed, and is how an agent plist is written', async () => {
    const path = join(dir, 'mine');
    await runner.writeFileAtomic(path, bytes('x'), { mode: 0o600, uid: runner.effectiveUid() });
    expect((await stat(path)).uid).toBe(runner.effectiveUid());
  });
});

describe('read, stat, remove', () => {
  test('absent paths read as undefined, including under a file', async () => {
    expect(await runner.readFile(join(dir, 'none'))).toBeUndefined();
    expect(await runner.stat(join(dir, 'none'))).toBeUndefined();
    await writeFile(join(dir, 'f'), 'x');
    expect(await runner.stat(join(dir, 'f', 'under'))).toBeUndefined();
  });

  test('stat is lstat: a symlink is reported as one, and mode carries no type bits', async () => {
    await writeFile(join(dir, 'target'), 'x', { mode: 0o600 });
    await symlink(join(dir, 'target'), join(dir, 'link'));
    expect((await runner.stat(join(dir, 'link')))?.kind).toBe('symlink');
    expect(await runner.stat(join(dir, 'target'))).toMatchObject({
      kind: 'file',
      mode: 0o600,
      size: 1,
    });
    expect((await runner.stat(dir))?.kind).toBe('directory');
  });

  test('readFile returns the bytes; removeFile is idempotent', async () => {
    await writeFile(join(dir, 'f'), 'hello');
    expect(new TextDecoder().decode(await runner.readFile(join(dir, 'f')))).toBe('hello');
    await runner.removeFile(join(dir, 'f'));
    await runner.removeFile(join(dir, 'f'));
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('exec', () => {
  test('argv is passed verbatim — no shell ever sees it', async () => {
    const result = await runner.exec(['/bin/echo', '$HOME;`id`|*']);
    expect(result).toEqual({ exitCode: 0, stderr: '', stdout: '$HOME;`id`|*\n' });
  });

  test('a non-zero exit is a result, not a throw', async () => {
    expect((await runner.exec(['/usr/bin/false'])).exitCode).not.toBe(0);
  });

  test('a program that does not exist rejects with its name', async () => {
    await expect(runner.exec([join(dir, 'missing')])).rejects.toThrow('missing');
    await expect(runner.exec([])).rejects.toThrow('empty argv');
  });

  test('never privileged, and reports the real euid', () => {
    expect(runner.privileged).toBe(false);
    expect(runner.effectiveUid()).toBe(process.geteuid?.() ?? -1);
  });
});

describe.skipIf(!['darwin', 'linux'].includes(process.platform))('lookups (read-only)', () => {
  test('the current user resolves by uid, with a home directory', async () => {
    const uid = process.getuid?.() ?? -1;
    const user = await runner.lookupUser(String(uid));
    expect(user?.uid).toBe(uid);
    expect(user?.home.startsWith('/')).toBe(true);
  });

  test('an unknown user and group are undefined, not errors', async () => {
    expect(await runner.lookupUser('hf-no-such-user-xyz')).toBeUndefined();
    expect(await runner.lookupGroup('hf-no-such-group-xyz')).toBeUndefined();
  });
});
