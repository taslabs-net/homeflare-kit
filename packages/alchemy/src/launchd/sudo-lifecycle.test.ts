/**
 * The real LaunchdJob and HostFile lifecycles, driven through sudoRunner over the fake host: the
 * deploying user is uid 501, and the only way anything root-owned changes is an allowlisted
 * `sudo -n` call. No real sudo, launchctl or /Library write happens.
 *
 * ★ The assertions are on the PRIVILEGED SEQUENCE, because that list is the whole point: a plan
 *   needs none, a create is install + bootstrap, a delete is bootout + rm.
 */
import { describe, expect, test } from 'bun:test';
import { fakeSudoHost } from './fake-sudo.ts';
import { deleteFile, reconcileFile } from './host-file-lifecycle.ts';
import type { LaunchdJobAttributes, LaunchdJobProps } from './job-form.ts';
import { deleteJob, diffJob, readJob, reconcileJob } from './job-lifecycle.ts';
import { INSTALL, RM } from './sudo-allowlist.ts';

const DAEMON = '/Library/LaunchDaemons/com.example.job.plist';
const job: LaunchdJobProps = {
  domain: 'system',
  keepAlive: true,
  label: 'com.example.job',
  programArguments: ['/usr/local/bin/job'],
};

/** Each privileged call as its program and first operand, e.g. `launchctl bootout`. */
const verbs = (privileged: string[][]) =>
  privileged.map(([program, first]) =>
    program === INSTALL ? 'install' : program === RM ? 'rm' : `launchctl ${String(first)}`,
  );

describe('a system daemon, deployed as the operator', () => {
  test('create is install then bootstrap; the plist lands root:wheel 0644', async () => {
    const host = fakeSudoHost();
    const attrs = await reconcileJob(host.runner, job, undefined);
    expect(verbs(host.privileged())).toEqual(['install', 'launchctl bootstrap']);
    expect(host.fake.files.get(DAEMON)).toMatchObject({ gid: 0, mode: 0o644, uid: 0 });
    expect(attrs).toMatchObject({ loaded: true, plistPath: DAEMON });
    expect(host.logs).toHaveLength(2);
  });

  test('a plan (read, diff) needs no sudo at all', async () => {
    const host = fakeSudoHost();
    const attrs = await reconcileJob(host.runner, job, undefined);
    const before = host.sudoCalls.length;
    expect(await readJob(host.runner, job)).toMatchObject({ loaded: true });
    expect(await diffJob(host.runner, job, attrs)).toEqual({ action: 'noop' });
    expect(await diffJob(host.runner, { ...job, runAtLoad: true }, attrs)).toEqual({
      action: 'update',
    });
    expect(host.sudoCalls).toHaveLength(before);
  });

  test('update is install, bootout, bootstrap — in that order', async () => {
    const host = fakeSudoHost();
    const attrs = await reconcileJob(host.runner, job, undefined);
    await reconcileJob(host.runner, { ...job, runAtLoad: true }, attrs);
    expect(verbs(host.privileged())).toEqual([
      'install',
      'launchctl bootstrap',
      'install',
      'launchctl bootout',
      'launchctl bootstrap',
    ]);
  });

  test('delete is bootout then rm', async () => {
    const host = fakeSudoHost();
    const attrs = await reconcileJob(host.runner, job, undefined);
    await deleteJob(host.runner, attrs);
    expect(verbs(host.privileged()).slice(2)).toEqual(['launchctl bootout', 'rm']);
    expect(host.fake.files.has(DAEMON)).toBe(false);
    expect(host.fake.loaded.has('system/com.example.job')).toBe(false);
  });

  test('sudo wanting a password on an update leaves the old job running, untouched', async () => {
    const host = fakeSudoHost();
    const attrs = await reconcileJob(host.runner, job, undefined);
    const pid = host.fake.loaded.get('system/com.example.job');
    const before = host.fake.files.get(DAEMON)?.bytes;
    host.state.sudo = 'password';
    await expect(reconcileJob(host.runner, { ...job, runAtLoad: true }, attrs)).rejects.toThrow(
      'a password is required',
    );
    expect(host.fake.loaded.get('system/com.example.job')).toBe(pid);
    expect(host.fake.files.get(DAEMON)?.bytes).toBe(before);
  });
});

describe("another user's gui domain is not elevated", () => {
  const theirs: LaunchdJobProps = { ...job, domain: 'gui/502' };

  test('create is refused at the write, with nothing written or loaded', async () => {
    const host = fakeSudoHost();
    await expect(reconcileJob(host.runner, theirs, undefined)).rejects.toThrow(
      'owner 502 needs root',
    );
    expect(host.fake.files.size).toBe(0);
    expect(host.sudoCalls).toEqual([]);
  });

  test('delete is refused at the bootout, and their job keeps running', async () => {
    const host = fakeSudoHost();
    host.fake.loaded.set('gui/502/com.example.job', 4242);
    const output: LaunchdJobAttributes = {
      domain: 'gui/502',
      label: 'com.example.job',
      loaded: true,
      plistPath: '/Users/other/Library/LaunchAgents/com.example.job.plist',
      plistSha256: '',
      serviceTarget: 'gui/502/com.example.job',
    };
    await expect(deleteJob(host.runner, output)).rejects.toThrow('elevates only the system domain');
    expect(host.fake.loaded.get('gui/502/com.example.job')).toBe(4242);
    expect(host.sudoCalls).toEqual([]);
  });
});

describe('a root-owned HostFile under a declared prefix', () => {
  const PATH = '/opt/example/app/exporter.yml';
  const file = {
    content: 'listen: 127.0.0.1:9100\n',
    group: 80,
    mode: 0o640,
    owner: 0,
    path: PATH,
  };

  test('is installed with its owner, group and mode, verified by the read-back', async () => {
    const host = fakeSudoHost();
    const attrs = await reconcileFile(host.runner, file);
    expect(attrs).toMatchObject({ gid: 80, mode: 0o640, uid: 0 });
    expect(host.privileged()[0]?.slice(0, 8)).toEqual([
      INSTALL,
      '-S',
      '-m',
      '0640',
      '-o',
      '0',
      '-g',
      '80',
    ]);
    await deleteFile(host.runner, attrs);
    expect(verbs(host.privileged())).toEqual(['install', 'rm']);
    expect(host.fake.files.has(PATH)).toBe(false);
  });

  test('a mode the operator could not read back is refused with nothing written', async () => {
    const host = fakeSudoHost();
    await expect(reconcileFile(host.runner, { ...file, group: 0, mode: 0o600 })).rejects.toThrow(
      'Nothing was written',
    );
    expect(host.fake.files.has(PATH)).toBe(false);
    expect(host.sudoCalls).toEqual([]);
  });
});
