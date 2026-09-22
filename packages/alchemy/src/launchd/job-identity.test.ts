/**
 * LaunchdJob's identity edges against the fake host: renames (a delete-first replace), jobs this
 * resource does not own, a gui domain with no login session, and what a failure leaves behind.
 *
 * ★ Split from job-lifecycle.test.ts, which covers the ordinary create / update / delete path.
 *   Every test here is a way to end up with NOTHING running, or TWO copies running.
 */
import { describe, expect, test } from 'bun:test';
import { fakeRunner } from './fake-runner.ts';
import type { LaunchdJobProps } from './job-form.ts';
import { deleteJob, diffJob, readJob, reconcileJob, replaceDiff } from './job-lifecycle.ts';

const DAEMON = '/Library/LaunchDaemons/com.example.job.plist';
const RENAMED = '/Library/LaunchDaemons/com.example.renamed.plist';
const AGENT = '/Users/someone/Library/LaunchAgents/com.example.job.plist';

const job: LaunchdJobProps = {
  domain: 'system',
  label: 'com.example.job',
  programArguments: ['/usr/local/bin/job'],
};
const renamed: LaunchdJobProps = { ...job, label: 'com.example.renamed' };

const host = (euid = 0) =>
  fakeRunner({
    dirs: { '/Library/LaunchDaemons': 0, '/Users/someone/Library/LaunchAgents': 501 },
    euid,
    users: { someone: { gid: 20, home: '/Users/someone', uid: 501 } },
  });

const verbs = (calls: string[][]) =>
  calls
    .map((call) => (call[0] === 'write' ? 'write' : call[1]))
    .filter((verb) => verb !== 'print' && verb !== 'print-disabled');

describe('a rename is refused at PLAN time for anything its reconcile would refuse', () => {
  // ★ The engine deletes the old job before reconciling the new one (deleteFirst), so each of
  //   these, caught only at reconcile, would leave nothing running.
  test('an invalid or reserved new label', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    const bad = { ...job, label: 'org.nixos.job' };
    await expect(diffJob(fake.runner, bad, output)).rejects.toThrow('another tool owns');
    await expect(replaceDiff(fake.runner, bad, undefined, output)).rejects.toThrow('another tool');
  });

  test('a new domain the deployer may not write', async () => {
    const fake = host(501);
    const agent = { ...job, domain: 'gui/501' } as const;
    const output = await reconcileJob(fake.runner, agent, undefined);
    await expect(diffJob(fake.runner, job, output)).rejects.toThrow('needs root');
    expect(fake.loaded.has('gui/501/com.example.job')).toBe(true);
  });

  test('a disabled new label', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    fake.disabled.add('system/com.example.renamed');
    await expect(diffJob(fake.runner, renamed, output)).rejects.toThrow('launchctl enable');
  });

  test('a new label someone else already loaded', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    fake.loaded.set('system/com.example.renamed', 77);
    await expect(diffJob(fake.runner, renamed, output)).rejects.toThrow('not this resource');
    expect(fake.loaded.get('system/com.example.renamed')).toBe(77);
  });

  test('a clean rename plans a delete-first replace', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    expect(await diffJob(fake.runner, renamed, output)).toEqual({
      action: 'replace',
      deleteFirst: true,
    });
  });
});

describe('a rename that reaches reconcile as an update', () => {
  test('boots out and removes the old job BEFORE bootstrapping the new one', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    fake.calls.length = 0;
    const next = await reconcileJob(fake.runner, renamed, output);
    expect(verbs(fake.calls)).toEqual(['bootout', 'write', 'bootstrap']);
    expect(fake.files.has(DAEMON)).toBe(false);
    expect(fake.loaded.has('system/com.example.job')).toBe(false);
    expect(next).toMatchObject({ loaded: true, plistPath: RENAMED });
  });

  test('never boots out a job it does not own under the new label', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    fake.loaded.set('system/com.example.renamed', 77);
    await expect(reconcileJob(fake.runner, renamed, output)).rejects.toThrow('not this resource');
    expect(fake.loaded.has('system/com.example.job')).toBe(true);
    expect(fake.loaded.get('system/com.example.renamed')).toBe(77);
  });
});

describe('a job still running its OLD config is not mistaken for converged', () => {
  test('write landed, bootout failed: the next deploy restarts it', async () => {
    const fake = host();
    const v1 = await reconcileJob(fake.runner, job, undefined);
    fake.state.bootoutKeepsJob = true;
    const v2 = { ...job, runAtLoad: true };
    await expect(reconcileJob(fake.runner, v2, v1)).rejects.toThrow('bootout');
    // The v2 plist is on disk and the v1 job is loaded: both look converged. Only state knows.
    fake.state.bootoutKeepsJob = false;
    fake.calls.length = 0;
    const after = await reconcileJob(fake.runner, v2, v1);
    expect(verbs(fake.calls)).toEqual(['write', 'bootout', 'bootstrap']);
    expect(after.pid).not.toBe(v1.pid);
  });
});

describe('a failed first bootstrap leaves nothing behind', () => {
  test('the plist it wrote is removed, so the next plan does not find it Unowned', async () => {
    const fake = host();
    fake.state.bootstrapFailure = { exitCode: 5, stderr: 'Bootstrap failed: 5', stdout: '' };
    await expect(reconcileJob(fake.runner, job, undefined)).rejects.toThrow('removed again');
    expect(fake.files.has(DAEMON)).toBe(false);
    expect(await readJob(fake.runner, job)).toBeUndefined();
  });
});

describe('a gui domain with no login session', () => {
  const agent = { ...job, domain: 'gui/501' } as const;

  test('reconcile refuses before writing anything', async () => {
    const fake = host(501);
    fake.state.loggedOut.add(501);
    await expect(reconcileJob(fake.runner, agent, undefined)).rejects.toThrow('no login session');
    expect(fake.files.has(AGENT)).toBe(false);
  });

  test('delete still removes the plist, so launchd cannot load it at the next login', async () => {
    const fake = host(501);
    const output = await reconcileJob(fake.runner, agent, undefined);
    fake.loaded.clear();
    fake.state.loggedOut.add(501);
    await deleteJob(fake.runner, output);
    expect(fake.files.has(AGENT)).toBe(false);
    expect(await readJob(fake.runner, agent)).toBeUndefined();
  });
});
