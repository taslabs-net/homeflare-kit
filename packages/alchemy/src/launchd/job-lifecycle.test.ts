/**
 * LaunchdJob's lifecycle against the fake host: no real launchctl, no real writes.
 *
 * ★ The assertions are on the SEQUENCE of host calls, because the ordering is the design — write
 *   before bootout before bootstrap, and nothing at all when the host is already converged.
 */
import { describe, expect, test } from 'bun:test';
import { fakeRunner } from './fake-runner.ts';
import type { LaunchdJobProps } from './job-form.ts';
import { deleteJob, diffJob, readJob, reconcileJob } from './job-lifecycle.ts';

const DAEMON = '/Library/LaunchDaemons/com.example.job.plist';
const AGENT = '/Users/someone/Library/LaunchAgents/com.example.job.plist';

const job: LaunchdJobProps = {
  domain: 'system',
  keepAlive: true,
  label: 'com.example.job',
  programArguments: ['/usr/local/bin/job'],
};

const host = (euid = 0, privileged = false) =>
  fakeRunner({
    dirs: { '/Library/LaunchDaemons': 0, '/Users/someone/Library/LaunchAgents': 501 },
    euid,
    privileged,
    users: { someone: { gid: 20, home: '/Users/someone', uid: 501 } },
  });

/** `bootstrap`, `write`, … — the verbs, in order, skipping the read-only ones. */
const writes = (calls: string[][]) =>
  calls
    .map((call) => (call[0] === 'write' ? 'write' : call[1]))
    .filter((verb) => verb !== 'print' && verb !== 'print-disabled');

describe('create', () => {
  test('writes the plist root:wheel 0644, then bootstraps it', async () => {
    const fake = host();
    const attrs = await reconcileJob(fake.runner, job, undefined);
    expect(writes(fake.calls)).toEqual(['write', 'bootstrap']);
    expect(fake.files.get(DAEMON)).toMatchObject({ gid: 0, mode: 0o644, uid: 0 });
    expect(attrs).toMatchObject({
      loaded: true,
      plistPath: DAEMON,
      serviceTarget: 'system/com.example.job',
      state: 'running',
    });
    expect(attrs.plistSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("an agent is written as its user into that user's LaunchAgents", async () => {
    const fake = host(501);
    const attrs = await reconcileJob(fake.runner, { ...job, domain: 'gui/501' }, undefined);
    expect(attrs.plistPath).toBe(AGENT);
    expect(fake.files.get(AGENT)).toMatchObject({ mode: 0o644, uid: 501 });
    expect(fake.loaded.has('gui/501/com.example.job')).toBe(true);
  });
});

describe('diff', () => {
  test('noop when nothing changed, on disk or in launchd', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    expect(await diffJob(fake.runner, job, output)).toEqual({ action: 'noop' });
  });

  test('update when a prop changes the rendered plist', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    expect(await diffJob(fake.runner, { ...job, runAtLoad: true }, output)).toEqual({
      action: 'update',
    });
  });

  test('update when the file was hand-edited, or the job was unloaded behind our back', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    const entry = fake.files.get(DAEMON);
    if (entry === undefined) throw new Error('no plist');
    fake.files.set(DAEMON, { ...entry, bytes: new TextEncoder().encode('hand edit') });
    expect(await diffJob(fake.runner, job, output)).toEqual({ action: 'update' });
    await reconcileJob(fake.runner, job, output);
    fake.loaded.clear();
    expect(await diffJob(fake.runner, job, output)).toEqual({ action: 'update' });
  });

  test('replace, deleting first, only when label or domain changes', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    const replace = { action: 'replace', deleteFirst: true } as const;
    expect(await diffJob(fake.runner, { ...job, label: 'com.example.renamed' }, output)).toEqual(
      replace,
    );
    expect(await diffJob(fake.runner, { ...job, domain: 'gui/501' }, output)).toEqual(replace);
  });

  test('a bad declaration fails the plan, not the apply', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    await expect(diffJob(fake.runner, { ...job, startInterval: 0 }, output)).rejects.toThrow(
      'startInterval',
    );
  });
});

describe('update', () => {
  test('write, then bootout, then bootstrap — a restart with a new pid', async () => {
    const fake = host();
    const first = await reconcileJob(fake.runner, job, undefined);
    fake.calls.length = 0;
    fake.state.lingerPrints = 2;
    const second = await reconcileJob(fake.runner, { ...job, runAtLoad: true }, first);
    expect(writes(fake.calls)).toEqual(['write', 'bootout', 'bootstrap']);
    expect(second.pid).not.toBe(first.pid);
    expect(second.plistSha256).not.toBe(first.plistSha256);
  });

  test('a converged job is not restarted', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    fake.calls.length = 0;
    const again = await reconcileJob(fake.runner, job, output);
    expect(writes(fake.calls)).toEqual([]);
    expect(again.pid).toBe(output.pid);
  });

  test('a failed bootstrap leaves state behind, so the next diff retries', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    fake.state.bootstrapFailure = {
      exitCode: 5,
      stderr: 'Bootstrap failed: 5: Input/output error',
      stdout: '',
    };
    const changed = { ...job, runAtLoad: true };
    await expect(reconcileJob(fake.runner, changed, output)).rejects.toThrow('NOT RUNNING');
    expect(fake.loaded.size).toBe(0);
    expect(await diffJob(fake.runner, changed, output)).toEqual({ action: 'update' });
  });
});

describe('refusals', () => {
  test('the system domain as a non-root user: refused before anything is written', async () => {
    const fake = host(501);
    await expect(reconcileJob(fake.runner, job, undefined)).rejects.toThrow('never calls sudo');
    expect(writes(fake.calls)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  test('a runner that declares itself privileged may write the system domain', async () => {
    const fake = host(501, true);
    expect((await reconcileJob(fake.runner, job, undefined)).loaded).toBe(true);
  });

  test("another user's gui domain needs root", async () => {
    const fake = fakeRunner({
      euid: 501,
      users: { other: { gid: 20, home: '/Users/other', uid: 502 } },
    });
    await expect(
      reconcileJob(fake.runner, { ...job, domain: 'gui/502' }, undefined),
    ).rejects.toThrow('another user');
  });

  test('a gui uid with no user on the host', async () => {
    const fake = host();
    await expect(
      reconcileJob(fake.runner, { ...job, domain: 'gui/777' }, undefined),
    ).rejects.toThrow('no home');
  });

  test('a disabled label is left disabled, with the command to change that', async () => {
    const fake = host();
    fake.disabled.add('system/com.example.job');
    await expect(reconcileJob(fake.runner, job, undefined)).rejects.toThrow(
      'launchctl enable system/com.example.job',
    );
    expect(fake.files.has(DAEMON)).toBe(false);
  });

  test('a reserved label never reaches the host', async () => {
    const fake = host();
    await expect(
      reconcileJob(fake.runner, { ...job, label: 'org.nixos.job' }, undefined),
    ).rejects.toThrow('another tool owns');
    expect(fake.calls).toEqual([]);
  });
});

describe('read', () => {
  test('nothing on disk and nothing loaded is undefined', async () => {
    expect(await readJob(host().runner, job)).toBeUndefined();
  });

  test('a plist on disk that is not loaded reads as present, not loaded', async () => {
    const fake = host();
    await reconcileJob(fake.runner, job, undefined);
    fake.loaded.clear();
    expect(await readJob(fake.runner, job)).toMatchObject({ loaded: false, plistPath: DAEMON });
  });
});

describe('delete', () => {
  test('boots out, removes the plist, and is idempotent', async () => {
    const fake = host();
    const output = await reconcileJob(fake.runner, job, undefined);
    fake.calls.length = 0;
    await deleteJob(fake.runner, output);
    expect(writes(fake.calls)).toEqual(['bootout']);
    expect(fake.files.has(DAEMON)).toBe(false);
    expect(fake.loaded.size).toBe(0);
    await deleteJob(fake.runner, output);
  });

  test('refused for a non-root user in the system domain', async () => {
    const root = host();
    const output = await reconcileJob(root.runner, job, undefined);
    await expect(deleteJob(host(501).runner, output)).rejects.toThrow('needs root');
  });
});
