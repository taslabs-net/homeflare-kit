/**
 * A systemd rename is a delete-first replace, so every refusal has to fire at PLAN time. Caught
 * only in reconcile, Alchemy has already stopped and removed the old unit (Apply.ts,
 * deleteOldGenerations under `node.deleteFirst`).
 *
 * ★ The last case is the one the diff cannot see: a name that was still an Output at plan time
 *   arrives at reconcile as an update (unit-handlers.ts). The same refusals have to fire there,
 *   before deleteUnit.
 */
import { describe, expect, test } from 'bun:test';
import { fakeLinuxHost } from './fake-linux-host.ts';
import { renderUnit } from './unit-form.ts';
import { deleteUnit, diffUnit, reconcileUnit } from './unit-lifecycle.ts';

const NAME = 'hf-example.service';
const PATH = `/etc/systemd/system/${NAME}`;
const RENAMED = 'hf-renamed.service';
const RENAMED_PATH = `/etc/systemd/system/${RENAMED}`;

const body = (exec: string) =>
  renderUnit([
    { lines: [['Description', 'an example']], name: 'Unit' },
    {
      lines: [
        ['ExecStart', exec],
        ['Restart', 'on-failure'],
      ],
      name: 'Service',
    },
    { lines: [['WantedBy', 'multi-user.target']], name: 'Install' },
  ]);

const props = { content: body('/usr/bin/example'), name: NAME };
const renamed = { ...props, name: RENAMED };
const host = () => fakeLinuxHost({ dirs: { '/etc/systemd/system': 0 } });

const running = async () => {
  const fake = host();
  const output = await reconcileUnit(fake.runner, props, undefined);
  return { fake, output };
};

describe('a rename is refused at plan time, and the old unit is still running', () => {
  test('a masked new name', async () => {
    const { fake, output } = await running();
    fake.placeUnit(RENAMED_PATH, body('/usr/bin/other'), { masked: true });
    await expect(diffUnit(fake.runner, renamed, output)).rejects.toThrow(/is masked/);
    expect(fake.units.get(NAME)?.active).toBe(true);
    expect(fake.files.has(PATH)).toBe(true);
  });

  test('a new name whose file belongs to someone else', async () => {
    const { fake, output } = await running();
    fake.placeUnit(RENAMED_PATH, body('/usr/bin/other'), { active: true, enabled: true });
    await expect(diffUnit(fake.runner, renamed, output)).rejects.toThrow(/not this resource/);
    expect(fake.units.get(NAME)?.active).toBe(true);
    expect(fake.units.get(RENAMED)?.active).toBe(true);
  });

  test('a file byte-identical to our render is our own leftover, not a claim', async () => {
    const { fake, output } = await running();
    fake.placeUnit(RENAMED_PATH, props.content);
    expect(await diffUnit(fake.runner, renamed, output)).toEqual({
      action: 'replace',
      deleteFirst: true,
    });
  });

  test('a runner that will not write the new path', async () => {
    const { fake, output } = await running();
    const refusing = {
      ...fake.runner,
      checkWrite: async () => {
        throw new Error('HostRunner.checkWrite refused');
      },
    };
    await expect(diffUnit(refusing, renamed, output)).rejects.toThrow(/checkWrite/);
    expect(fake.units.get(NAME)?.active).toBe(true);
  });

  test('the old unit must be deletable before a delete-first replace is promised', async () => {
    const { fake, output } = await running();
    const unprivileged = { ...fake.runner, effectiveUid: () => 1001, privileged: false };
    await expect(diffUnit(unprivileged, renamed, output)).rejects.toThrow(/never calls sudo/);
    expect(fake.units.get(NAME)?.active).toBe(true);
    expect(fake.files.has(PATH)).toBe(true);
  });
});

describe('a free name', () => {
  test('plans a delete-first replace, and delete-then-reconcile leaves only the new unit', async () => {
    const { fake, output } = await running();
    expect(await diffUnit(fake.runner, renamed, output)).toEqual({
      action: 'replace',
      deleteFirst: true,
    });
    await deleteUnit(fake.runner, output);
    const next = await reconcileUnit(fake.runner, renamed, output);
    expect(next).toMatchObject({
      active: true,
      enabled: true,
      name: RENAMED,
      unitPath: RENAMED_PATH,
    });
    expect(fake.files.has(PATH)).toBe(false);
    expect(fake.files.has(RENAMED_PATH)).toBe(true);
    expect(fake.units.get(NAME)?.active ?? false).toBe(false);
  });
});

describe('a rename the diff could not see is refused at apply, before the old unit stops', () => {
  test('a masked new name', async () => {
    const { fake, output } = await running();
    fake.placeUnit(RENAMED_PATH, body('/usr/bin/other'), { masked: true });
    await expect(reconcileUnit(fake.runner, renamed, output)).rejects.toThrow(/is masked/);
    expect(fake.units.get(NAME)?.active).toBe(true);
    expect(fake.files.has(PATH)).toBe(true);
  });

  test('a new name whose file belongs to someone else', async () => {
    const { fake, output } = await running();
    fake.placeUnit(RENAMED_PATH, body('/usr/bin/other'), { active: true, enabled: true });
    await expect(reconcileUnit(fake.runner, renamed, output)).rejects.toThrow(/not this resource/);
    expect(fake.units.get(NAME)?.active).toBe(true);
    expect(fake.files.has(PATH)).toBe(true);
    expect(fake.units.get(RENAMED)?.active).toBe(true);
  });
});
