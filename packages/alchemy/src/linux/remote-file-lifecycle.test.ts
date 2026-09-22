/**
 * RemoteFile against the fake Linux host (no ssh, no real writes): whole-file mode, region mode,
 * drift detection and the ownership refusals.
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

const PATH = '/etc/example/app.conf';
const props = { content: 'listen = 127.0.0.1:9000\n', path: PATH };
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

const writes = (calls: string[][]) => calls.filter((call) => call[0] === 'write').length;

describe('whole-file mode', () => {
  test('writes with the default mode and returns what is on the host', async () => {
    const fake = host();
    const attrs = await reconcileFile(fake.runner, props);
    expect(attrs).toMatchObject({ mode: 0o644, path: PATH, size: props.content.length, uid: 0 });
    expect(decode(fake.files.get(PATH)?.bytes)).toBe(props.content);
  });

  test('an already-matching file is not rewritten', async () => {
    const fake = host();
    const first = await reconcileFile(fake.runner, props);
    await reconcileFile(fake.runner, props, first);
    expect(writes(fake.calls)).toBe(1);
  });

  test('mode and owner drift is detected, not just content', async () => {
    const fake = host();
    const output = await reconcileFile(fake.runner, { ...props, mode: 0o640 });
    expect(await diffFile(fake.runner, { ...props, mode: 0o640 }, output)).toEqual({
      action: 'noop',
    });
    // A hand `chmod` on the host, with the content untouched.
    const entry = fake.files.get(PATH);
    if (entry !== undefined) entry.mode = 0o666;
    expect(await diffFile(fake.runner, { ...props, mode: 0o640 }, output)).toEqual({
      action: 'update',
    });
    const fixed = await reconcileFile(fake.runner, { ...props, mode: 0o640 }, output);
    expect(fixed.mode).toBe(0o640);
  });

  test('owner and group resolve by name, and a foreign owner needs root', async () => {
    const fake = host();
    const owned = await reconcileFile(fake.runner, { ...props, group: 'staff', owner: 'someone' });
    expect(owned).toMatchObject({ gid: 50, uid: 1001 });
    const unprivileged = host(1001);
    await expect(
      reconcileFile(unprivileged.runner, { ...props, owner: 'root', path: '/home/someone/x' }),
    ).rejects.toThrow(/only root may chown/);
  });

  test('a file that is not this resource is refused unless adoption is on', async () => {
    const fake = host();
    await fake.runner.writeFileAtomic(PATH, new TextEncoder().encode('someone else\n'), {
      mode: 0o644,
    });
    await expect(reconcileFile(fake.runner, props)).rejects.toThrow(/deploy --adopt/);
    const adopted = await reconcileFile(fake.runner, props, undefined, true);
    expect(adopted.sha256).not.toBe('');
  });

  test('delete removes the file and is idempotent', async () => {
    const fake = host();
    const attrs = await reconcileFile(fake.runner, props);
    await deleteFile(fake.runner, attrs);
    await deleteFile(fake.runner, attrs);
    expect(fake.files.has(PATH)).toBe(false);
  });
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

describe('a failed read refuses', () => {
  test('a stat that throws is never read as “nothing is there”', async () => {
    const fake = host();
    const broken = {
      ...fake.runner,
      stat: async () => {
        throw new Error('ssh somewhere: the remote command did not report a status');
      },
    };
    await expect(reconcileFile(broken, props)).rejects.toThrow(/did not report a status/);
    await expect(readFileAttributes(broken, PATH, undefined)).rejects.toThrow(/did not report/);
  });
});
