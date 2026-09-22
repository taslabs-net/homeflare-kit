/**
 * RemoteFile in MANAGED REGION mode against the fake Linux host: the promise that every byte
 * outside the markers survives, and the identity rules that keep it true when a declaration
 * changes. Split from remote-file-lifecycle.test.ts, which covers whole-file mode.
 */
import { describe, expect, test } from 'bun:test';
import { fakeLinuxHost } from './fake-linux-host.ts';
import { fileProblems } from './remote-file-form.ts';
import {
  deleteFile,
  diffFile,
  readFileAttributes,
  reconcileFile,
} from './remote-file-lifecycle.ts';

const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

const host = (euid = 0) =>
  fakeLinuxHost({
    dirs: { '/etc': 0, '/etc/example': 0, '/home/someone': 1001 },
    euid,
    groups: { root: 0, staff: 50 },
    users: {
      root: { gid: 0, home: '/root', uid: 0 },
      someone: { gid: 1001, home: '/home/someone', uid: 1001 },
    },
  });

describe('region mode', () => {
  const VENDOR = '# vendor ruleset\nanchor "system"\nrule one\n';
  const region = { name: 'homeflare' };
  const block = { content: 'anchor "declared"\n', path: '/etc/vendor.conf', region };

  const withVendor = () => {
    const fake = host();
    fake.files.set('/etc/vendor.conf', {
      bytes: new TextEncoder().encode(VENDOR),
      gid: 0,
      kind: 'file',
      mode: 0o600,
      uid: 0,
    });
    return fake;
  };

  test('editing the block leaves the rest of the file byte-identical', async () => {
    const fake = withVendor();
    const output = await reconcileFile(fake.runner, block);
    const after = decode(fake.files.get('/etc/vendor.conf')?.bytes);
    expect(after.startsWith(VENDOR)).toBe(true);
    await reconcileFile(fake.runner, { ...block, content: 'anchor "changed"\n' }, output);
    expect(decode(fake.files.get('/etc/vendor.conf')?.bytes).startsWith(VENDOR)).toBe(true);
  });

  test("the other owner's mode and uid are preserved, never re-declared", async () => {
    const fake = withVendor();
    await reconcileFile(fake.runner, block);
    expect(fake.files.get('/etc/vendor.conf')?.mode).toBe(0o600);
  });

  test('a change anywhere else in the file is not this resource’s drift', async () => {
    const fake = withVendor();
    const output = await reconcileFile(fake.runner, block);
    const edited = `${decode(fake.files.get('/etc/vendor.conf')?.bytes)}rule two\n`;
    fake.files.set('/etc/vendor.conf', {
      bytes: new TextEncoder().encode(edited),
      gid: 0,
      kind: 'file',
      mode: 0o600,
      uid: 0,
    });
    expect(await diffFile(fake.runner, block, output)).toEqual({ action: 'noop' });
  });

  test('delete removes only the block', async () => {
    const fake = withVendor();
    const output = await reconcileFile(fake.runner, block);
    await deleteFile(fake.runner, output);
    expect(decode(fake.files.get('/etc/vendor.conf')?.bytes)).toBe(VENDOR);
  });

  test('a missing file is a refusal, because a typo is likelier than an intention', async () => {
    const fake = host();
    await expect(
      reconcileFile(fake.runner, { ...block, path: '/etc/example/absent.conf' }),
    ).rejects.toThrow(/does not create the file it lives in/);
    const created = await reconcileFile(fake.runner, {
      ...block,
      create: true,
      path: '/etc/example/absent.conf',
    });
    expect(created.region).toEqual(region);
  });

  /**
   * 🔴 BOTH OF THESE SHIPPED AS `update` AND WERE FOUND BY REVIEW (2026-09-22). They are the two
   *   ways the region promise could be broken from an ordinary edit to a stack file.
   */
  test('renaming the region moves the block; the old markers do not survive', async () => {
    const fake = withVendor();
    const output = await reconcileFile(fake.runner, block);
    const renamed = { ...block, region: { name: 'homeflare-mcp' } };
    // ⛔ An update, not a noop: the new block is not in the file yet.
    expect(await diffFile(fake.runner, renamed, output)).toEqual({ action: 'update' });
    const moved = await reconcileFile(fake.runner, renamed, output);
    const after = decode(fake.files.get('/etc/vendor.conf')?.bytes);
    expect(after.startsWith(VENDOR)).toBe(true);
    expect(after).not.toContain('BEGIN homeflare\n');
    expect(after).toContain('BEGIN homeflare-mcp');
    // ⛔ The stored digest must describe the file AFTER the old block was taken out.
    const live = await readFileAttributes(fake.runner, '/etc/vendor.conf', renamed.region);
    expect(moved.sha256).toBe(live?.sha256 ?? '');
    await deleteFile(fake.runner, moved);
    expect(decode(fake.files.get('/etc/vendor.conf')?.bytes)).toBe(VENDOR);
  });

  test('changing the comment token is a rename, not a reformat', async () => {
    const fake = withVendor();
    const output = await reconcileFile(fake.runner, block);
    const retokened = { ...block, region: { comment: '//', name: 'homeflare' } };
    await reconcileFile(fake.runner, retokened, output);
    const after = decode(fake.files.get('/etc/vendor.conf')?.bytes);
    expect(after).toContain('// BEGIN homeflare');
    expect(after).not.toContain('# BEGIN homeflare');
  });

  test('a file this resource borrowed is never taken over by dropping the region', async () => {
    const fake = withVendor();
    const output = await reconcileFile(fake.runner, block);
    const whole = { content: block.content, path: block.path };
    // ⛔ At plan time, before a single byte moves.
    await expect(diffFile(fake.runner, whole, output)).rejects.toThrow(/two different claims/);
    await expect(reconcileFile(fake.runner, whole, output)).rejects.toThrow(/two different claims/);
    expect(decode(fake.files.get('/etc/vendor.conf')?.bytes).startsWith(VENDOR)).toBe(true);
  });

  test('adding a region to a file this resource owned whole is refused the same way', async () => {
    const fake = host();
    const whole = { content: 'a = 1\n', path: '/etc/example/whole.conf' };
    const output = await reconcileFile(fake.runner, whole);
    await expect(
      diffFile(fake.runner, { ...whole, region: { name: 'homeflare' } }, output),
    ).rejects.toThrow(/two different claims/);
  });

  test('a rename onto a block someone else already owns is refused', async () => {
    const fake = withVendor();
    const output = await reconcileFile(fake.runner, block);
    const taken = `${decode(fake.files.get('/etc/vendor.conf')?.bytes)}# BEGIN other\nnot ours\n# END other\n`;
    fake.files.set('/etc/vendor.conf', {
      bytes: new TextEncoder().encode(taken),
      gid: 0,
      kind: 'file',
      mode: 0o600,
      uid: 0,
    });
    await expect(
      reconcileFile(fake.runner, { ...block, region: { name: 'other' } }, output),
    ).rejects.toThrow(/already carries that managed region/);
  });

  test('mode and owner without create are refused at validation', () => {
    expect(fileProblems({ ...block, mode: 0o600 })).toHaveLength(1);
    expect(fileProblems({ ...block, create: true, mode: 0o600 })).toEqual([]);
  });

  test('a block already there with other content needs --adopt', async () => {
    const fake = withVendor();
    fake.files.set('/etc/vendor.conf', {
      bytes: new TextEncoder().encode(
        `${VENDOR}# BEGIN homeflare\nsomething else\n# END homeflare\n`,
      ),
      gid: 0,
      kind: 'file',
      mode: 0o600,
      uid: 0,
    });
    await expect(reconcileFile(fake.runner, block)).rejects.toThrow(/managed region/);
    await expect(reconcileFile(fake.runner, block, undefined, true)).resolves.toBeDefined();
  });
});
