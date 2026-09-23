/**
 * `Systemd.Unit` and `Remote.File`'s own lifecycle functions, driven through sshSudoRunner over
 * the fake Linux host — proving the two families this runner exists for actually work end to end,
 * not just that the runner's own primitives do. No sudo runs anywhere but through the fake.
 */
import { describe, expect, test } from 'bun:test';
import { fakeSudoHost } from './fake-sudo.ts';
import { SudoRefusedError } from './sudo-runner.ts';
import { deleteFile, reconcileFile } from './remote-file-lifecycle.ts';
import type { RemoteFileProps } from './remote-file-form.ts';
import { deleteUnit, diffUnit, reconcileUnit } from './unit-lifecycle.ts';
import type { SystemdUnitProps } from './unit-form.ts';

const UNIT: SystemdUnitProps = {
  name: 'hf-thing.service',
  sections: [
    { lines: [['Description', 'a thing']], name: 'Unit' },
    { lines: [['ExecStart', '/usr/local/bin/hf-thing']], name: 'Service' },
    { lines: [['WantedBy', 'multi-user.target']], name: 'Install' },
  ],
};

describe('Systemd.Unit through sshSudoRunner', () => {
  test('create writes, reloads, enables and starts — all elevated', async () => {
    const { privileged, runner } = fakeSudoHost();
    const attrs = await reconcileUnit(runner, UNIT, undefined);
    expect(attrs.active).toBe(true);
    expect(attrs.enabled).toBe(true);
    const verbs = privileged().map((call) => call[0]);
    expect(verbs.filter((v) => v === 'systemctl')).toEqual([]); // canonicalised to the absolute path
    expect(verbs).toContain('/usr/bin/systemctl');
    // write (install+mv), daemon-reload, enable, start.
    expect(privileged().filter((c) => c[0] === '/usr/bin/install')).toHaveLength(1);
    expect(
      privileged().some((c) => c[0] === '/usr/bin/systemctl' && c[1] === 'daemon-reload'),
    ).toBe(true);
    expect(privileged().some((c) => c[1] === 'enable')).toBe(true);
    expect(privileged().some((c) => c[1] === 'start')).toBe(true);
  });

  test('an unchanged unit is reconciled again with zero privileged calls', async () => {
    const { privileged, runner } = fakeSudoHost();
    const created = await reconcileUnit(runner, UNIT, undefined);
    expect(await diffUnit(runner, UNIT, created)).toEqual({ action: 'noop' });
    const before = privileged().length;
    const again = await reconcileUnit(runner, UNIT, created);
    expect(privileged().length).toBe(before); // ★ no restart, no reload — the whole point.
    expect(again.active).toBe(true);
  });

  test('a restartOn digest change updates and restarts, via elevated calls only', async () => {
    const { privileged, runner } = fakeSudoHost();
    const created = await reconcileUnit(runner, UNIT, undefined);
    const changed: SystemdUnitProps = { ...UNIT, restartOn: ['new-digest'] };
    expect((await diffUnit(runner, changed, created))?.action).toBe('update');
    const before = privileged().length;
    const updated = await reconcileUnit(runner, changed, created);
    expect(privileged().length).toBeGreaterThan(before);
    expect(updated.configSha256).not.toBe(created.configSha256);
  });

  test('delete stops, disables, removes the file, reloads — all elevated', async () => {
    const { fake, privileged, runner } = fakeSudoHost();
    const created = await reconcileUnit(runner, UNIT, undefined);
    await deleteUnit(runner, created);
    expect(fake.files.has(created.unitPath)).toBe(false);
    const verbs = privileged()
      .filter((c) => c[0] === '/usr/bin/systemctl')
      .map((c) => c[1]);
    expect(verbs).toContain('stop');
    expect(verbs).toContain('disable');
    expect(verbs).toContain('daemon-reload');
    expect(privileged().some((c) => c[0] === '/usr/bin/rm')).toBe(true);
  });

  test('a vendor unit outside every prefix is unreachable, refused before sudo runs', async () => {
    const { fake, privileged, runner } = fakeSudoHost();
    fake.placeUnit('/usr/lib/systemd/system/pveproxy.service', '[Service]\nExecStart=/x\n', {
      active: true,
      enabled: true,
    });
    await expect(runner.exec(['systemctl', 'restart', '--', 'pveproxy.service'])).rejects.toThrow(
      SudoRefusedError,
    );
    await expect(runner.exec(['systemctl', 'restart', '--', 'pveproxy.service'])).rejects.toThrow(
      'FragmentPath',
    );
    expect(privileged()).toEqual([]);
  });
});

const SCRIPT: RemoteFileProps = {
  content: '#!/bin/sh\necho hi\n',
  mode: 0o755,
  path: '/usr/local/bin/hf-thing',
};

describe('Remote.File through sshSudoRunner', () => {
  test('create, update and delete, all through install/mv/rm', async () => {
    const { fake, privileged, runner } = fakeSudoHost();
    const created = await reconcileFile(runner, SCRIPT);
    expect(fake.files.get(SCRIPT.path)?.mode).toBe(0o755);
    expect(privileged().map((c) => c[0])).toEqual(['/usr/bin/install', '/usr/bin/mv']);

    const updated = await reconcileFile(
      runner,
      { ...SCRIPT, content: '#!/bin/sh\necho bye\n' },
      created,
    );
    expect(new TextDecoder().decode(fake.files.get(SCRIPT.path)?.bytes)).toContain('bye');

    await deleteFile(runner, updated);
    expect(fake.files.has(SCRIPT.path)).toBe(false);
    expect(privileged().some((c) => c[0] === '/usr/bin/rm' && c.at(-1) === SCRIPT.path)).toBe(true);
  });
});
