/**
 * sudoRunner's 2026-09-21 refusals, over the fake host (fake-sudo.ts): no group/world-writable,
 * setuid or setgid root-owned file under a prefix, and no directory from the prefix down that root
 * does not own alone. Each is refused before anything is staged or run as root — and, through
 * `checkWrite`, at PLAN time, still without sudo.
 */
import { describe, expect, test } from 'bun:test';
import { OPERATOR, fakeSudoHost } from './fake-sudo.ts';
import { diffFile, reconcileFile } from './host-file-lifecycle.ts';
import type { LaunchdJobProps } from './job-form.ts';
import { diffJob, reconcileJob } from './job-lifecycle.ts';
import { SudoRefusedError } from './sudo-allowlist.ts';
import { modeProblem } from './sudo-guard.ts';

const CONF = '/opt/example/app/a.conf';
const bytes = (text: string) => new TextEncoder().encode(text);
type Host = ReturnType<typeof fakeSudoHost>;
const dir = (mode: number, uid = 0) => ({
  bytes: bytes(''),
  gid: 0,
  kind: 'directory' as const,
  mode,
  uid,
});

describe('modeProblem', () => {
  test.each([
    ['0644 root', { mode: 0o644, uid: 0 }, undefined],
    ['0755 with the owner omitted (root under a prefix)', { mode: 0o755 }, undefined],
    ['0640 root', { mode: 0o640, uid: 0 }, undefined],
    ['sticky 1755 changes nothing on a file', { mode: 0o1755 }, undefined],
    ['0664 root is group-writable', { mode: 0o664 }, 'writable by group or other'],
    ['0646 root is world-writable', { mode: 0o646, uid: 0 }, 'writable by group or other'],
    ['4755 root is setuid', { mode: 0o4755 }, 'setuid/setgid'],
    ['2755 root is setgid', { mode: 0o2755, uid: 0 }, 'setuid/setgid'],
    ['6777 root is both', { mode: 0o6777 }, 'setuid/setgid and writable by group or other'],
    ['0664 handed to another user is theirs to change', { mode: 0o664, uid: OPERATOR }, undefined],
  ] as const)('%s', (_name, options, found) => {
    const problem = modeProblem(options);
    if (found === undefined) expect(problem).toBeUndefined();
    else expect(problem).toContain(found);
  });
});

describe('a root-owned install under a prefix', () => {
  test.each([0o664, 0o646, 0o4755, 0o2755])(
    'mode %o is refused before staging or sudo',
    async (mode) => {
      const host = fakeSudoHost();
      const write = host.runner.writeFileAtomic(CONF, bytes('x'), { mode });
      await expect(write).rejects.toBeInstanceOf(SudoRefusedError);
      await expect(write).rejects.toThrow('on a root-owned file');
      expect(host.state.stagedCount).toBe(0);
      expect(host.sudoCalls).toEqual([]);
    },
  );

  test('an omitted-owner 0644 still installs, as root', async () => {
    const host = fakeSudoHost();
    await host.runner.writeFileAtomic(CONF, bytes('x'), { mode: 0o644 });
    expect(host.fake.files.get(CONF)).toMatchObject({ mode: 0o644, uid: 0 });
  });
});

describe('every directory from the prefix down to the file', () => {
  const below: [string, (h: Host) => void, string][] = [
    ['owned by the operator', (h) => h.fake.dirs.set('/opt/example/app', OPERATOR), 'uid 501'],
    ['group-writable', (h) => h.fake.files.set('/opt/example/app', dir(0o775)), '0775'],
    ['world-writable', (h) => h.fake.files.set('/opt/example/app', dir(0o757)), '0757'],
  ];

  test.each(below)('%s is refused for a write, before staging or sudo', async (_n, setup, says) => {
    const host = fakeSudoHost();
    setup(host);
    const write = host.runner.writeFileAtomic(CONF, bytes('x'), { mode: 0o644 });
    await expect(write).rejects.toBeInstanceOf(SudoRefusedError);
    await expect(write).rejects.toThrow(
      /\/opt\/example\/app is .*(uid 501|0775|0757).*Every directory from the prefix/s,
    );
    await expect(write).rejects.toThrow(says);
    expect(host.state.stagedCount).toBe(0);
    expect(host.sudoCalls).toEqual([]);
  });

  test.each(below)('%s is refused for a remove too', async (_n, setup, says) => {
    const host = fakeSudoHost();
    host.fake.files.set(CONF, { ...dir(0o644), kind: 'file' });
    setup(host);
    await expect(host.runner.removeFile(CONF)).rejects.toThrow(says);
    expect(host.sudoCalls).toEqual([]);
  });
});

describe('at plan time, through checkWrite — reads only, never sudo', () => {
  test('HostFile: a diff that would write a setuid root file fails the plan', async () => {
    const host = fakeSudoHost();
    const output = await reconcileFile(host.runner, { content: 'x', mode: 0o755, path: CONF });
    const before = host.sudoCalls.length;
    const plan = diffFile(host.runner, { content: 'x', mode: 0o4755, path: CONF }, output);
    await expect(plan).rejects.toThrow('setuid/setgid');
    expect(host.sudoCalls).toHaveLength(before);
    // ★ A converged file plans noop and asks nothing, so an unrelated plan is never blocked by it.
    expect(await diffFile(host.runner, { content: 'x', mode: 0o755, path: CONF }, output)).toEqual({
      action: 'noop',
    });
  });

  test('HostFile: a new path under a directory another user may write fails the plan', async () => {
    const host = fakeSudoHost();
    const output = await reconcileFile(host.runner, { content: 'x', path: CONF });
    host.fake.dirs.set('/opt/example/other', OPERATOR);
    const moved = { content: 'x', path: '/opt/example/other/a.conf' };
    await expect(diffFile(host.runner, moved, output)).rejects.toThrow('uid 501');
  });

  test.each([
    ['an update', { runAtLoad: true }],
    ['a rename (the delete-first replace)', { label: 'com.example.renamed' }],
  ] as const)(
    'LaunchdJob: %s into a group-writable LaunchDaemons fails the plan',
    async (_n, change) => {
      const job: LaunchdJobProps = {
        domain: 'system',
        label: 'com.example.job',
        programArguments: ['/usr/local/bin/job'],
      };
      const host = fakeSudoHost();
      const attrs = await reconcileJob(host.runner, job, undefined);
      host.fake.files.set('/Library/LaunchDaemons', dir(0o775));
      const before = host.sudoCalls.length;
      await expect(diffJob(host.runner, { ...job, ...change }, attrs)).rejects.toThrow('0775');
      expect(host.sudoCalls).toHaveLength(before);
    },
  );
});
