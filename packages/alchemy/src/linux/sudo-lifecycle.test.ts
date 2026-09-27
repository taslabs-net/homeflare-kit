/**
 * `Systemd.Unit`, `Remote.File` and `Podman.Container`'s own lifecycle functions, driven through
 * sshSudoRunner over the fake Linux host — proving the families this runner exists for actually
 * work end to end, not just that the runner's own primitives do. No sudo runs anywhere but through
 * the fake.
 */
import { describe, expect, test } from 'bun:test';
import { fakeQuadletHost } from './fake-quadlet.ts';
import { fakeSudoHost } from './fake-sudo.ts';
import { SudoRefusedError } from './sudo-runner.ts';
import { deleteFile, reconcileFile } from './remote-file-lifecycle.ts';
import type { RemoteFileProps } from './remote-file-form.ts';
import { deleteUnit, diffUnit, reconcileUnit } from './unit-lifecycle.ts';
import type { SystemdUnitProps } from './unit-form.ts';
import { reconcileContainer } from './container-lifecycle.ts';
import type { ContainerProps } from './container-form.ts';

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

  // 🔴 Adversarial review, round 2: a masked vendor unit also reads FragmentPath empty, which
  //   used to fall into the "no file, elevate anyway" exemption regardless of verb.
  test('a masked unit is refused, even one this runner’s own prefix could otherwise reach', async () => {
    const { fake, privileged, runner } = fakeSudoHost();
    fake.placeUnit('/etc/systemd/system/pveproxy.service', '[Service]\nExecStart=/x\n', {
      active: false,
      enabled: false,
      masked: true,
    });
    for (const verb of ['enable', 'start', 'stop', 'disable', 'restart']) {
      await expect(runner.exec(['systemctl', verb, '--', 'pveproxy.service'])).rejects.toThrow(
        'is masked',
      );
    }
    expect(privileged()).toEqual([]);
  });

  // 🔴 Adversarial review, round 2: the empty-FragmentPath exemption used to admit every write
  //   verb, not just the two `deleteUnit` actually needs — so a kernel-generated pseudo-unit like
  //   `init.scope` (empty FragmentPath, never file-backed) could still elevate enable/start/restart.
  test('a unit with no file at all elevates stop/disable but refuses enable/start/restart', async () => {
    const { privileged, runner } = fakeSudoHost();
    for (const verb of ['enable', 'start', 'restart']) {
      await expect(runner.exec(['systemctl', verb, '--', 'init.scope'])).rejects.toThrow(
        'is not stop/disable',
      );
    }
    expect(privileged()).toEqual([]);
    // stop/disable of a genuinely unknown unit still REACHES systemctl as root (which itself
    // then judges it, exit 0 or not) — this runner's job is only to decide whether to ASK as
    // root, not to pre-judge every unit name that might exist.
    await runner.exec(['systemctl', 'stop', '--', 'init.scope']);
    expect(privileged().some((c) => c[0] === '/usr/bin/systemctl' && c[1] === 'stop')).toBe(true);
  });
});

// 🔴 REGRESSION, CT100 deploy 2026-09-26 00:11Z: `Podman.Container caddy`'s generated unit's
//   FragmentPath (`/run/systemd/generator/…`) was refused outright by the ownership check above,
//   even though its SourcePath (`/etc/containers/systemd/caddy.container`) was this runner's own
//   `.container` file, under a declared prefix. `fakeQuadletHost` in place of the plain
//   `fakeLinuxHost` (via `fakeSudoHost`'s `hostFactory`) reproduces the exact CT100 shape: a
//   generated unit whose FragmentPath is the generator's own output directory.
const CADDY_PREFIXES = ['/etc/containers/systemd', '/etc/systemd/system'];
const CADDY: ContainerProps = {
  container: { image: 'docker.io/library/caddy:2', network: 'host' },
  install: { wantedBy: ['multi-user.target'] },
  name: 'caddy',
  service: { restart: 'always' },
};

describe('Podman.Container through sshSudoRunner', () => {
  test(
    'a full reconcile writes, reloads and starts — the generated unit’s FragmentPath under ' +
      'the generator is reachable because its SourcePath is under a declared prefix',
    async () => {
      const { privileged, runner } = fakeSudoHost({}, undefined, {
        hostFactory: fakeQuadletHost,
        prefixes: CADDY_PREFIXES,
      });
      const attrs = await reconcileContainer(runner, CADDY, undefined);
      expect(attrs.active).toBe(true);
      expect(attrs.sourcePath).toBe('/etc/containers/systemd/caddy.container');
      const verbs = privileged()
        .filter((c) => c[0] === '/usr/bin/systemctl')
        .map((c) => c[1]);
      expect(verbs).toContain('daemon-reload');
      expect(verbs).toContain('start');
    },
  );

  test('a generated unit whose SourcePath is outside every declared prefix still refuses', async () => {
    const { fake, privileged, runner } = fakeSudoHost({}, undefined, {
      hostFactory: fakeQuadletHost,
      prefixes: CADDY_PREFIXES,
    });
    // A `.container` file Quadlet's OWN search path would also read (podman-systemd.unit(5)), but
    // not under any prefix THIS runner declared — a foreign Quadlet source, same idea as the
    // vendor `pveproxy.service` test above for a plain unit.
    fake.files.set('/run/containers/systemd/other.container', {
      bytes: new TextEncoder().encode('[Container]\nImage=example/other:1\n'),
      gid: 0,
      kind: 'file',
      mode: 0o644,
      uid: 0,
    });
    await runner.exec(['systemctl', 'daemon-reload']);
    await expect(runner.exec(['systemctl', 'restart', '--', 'other.service'])).rejects.toThrow(
      /SourcePath .* is not under one either/,
    );
    expect(privileged().some((c) => c[1] === 'restart')).toBe(false);
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
