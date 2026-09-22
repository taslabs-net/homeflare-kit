/**
 * A RENAME IS THE ONE SHAPE A REFUSAL CANNOT BE LATE FOR. Alchemy deletes the old unit before it
 * reconciles the new one, so these checks belong to the PLAN. 🔴 Found by review (2026-09-22): the
 * refusals existed, but only in `reconcileUnit` — by which time the service was already stopped,
 * disabled and its file removed.
 */
import { describe, expect, test } from 'bun:test';
import { fakeLinuxHost } from './fake-linux-host.ts';
import { renderUnit } from './unit-form.ts';
import { assertReplaceable, diffUnit } from './unit-lifecycle.ts';

const NAME = 'hf-example.service';
const NEXT = 'hf-renamed.service';
const DIR = '/etc/systemd/system';
const body = (exec: string) =>
  renderUnit([
    { lines: [['Description', 'example']], name: 'Unit' },
    { lines: [['ExecStart', exec]], name: 'Service' },
    { lines: [['WantedBy', 'multi-user.target']], name: 'Install' },
  ]);

const props = { content: body('/usr/bin/example'), name: NEXT };
const output = {
  active: true,
  activeState: 'active',
  configSha256: '',
  enabled: true,
  loadState: 'loaded',
  name: NAME,
  unitFileState: 'enabled',
  unitPath: `${DIR}/${NAME}`,
  unitSha256: 'whatever',
};
const host = () => fakeLinuxHost({ dirs: { [DIR]: 0 } });

describe('the name a rename moves to', () => {
  test('a free name plans a delete-first replace', async () => {
    const fake = host();
    expect(await diffUnit(fake.runner, props, output)).toEqual({
      action: 'replace',
      deleteFirst: true,
    });
    // ⛔ Read-only: a plan writes nothing, whatever it decided.
    expect(fake.calls.filter((call) => call[0] === 'write')).toHaveLength(0);
  });

  test('a MASKED target is refused by the plan, not after the old unit is gone', async () => {
    const fake = host();
    fake.placeUnit(`${DIR}/${NEXT}`, props.content, { masked: true });
    await expect(diffUnit(fake.runner, props, output)).rejects.toThrow(/is masked/);
  });

  test('a unit file already there and not ours is refused by the plan', async () => {
    const fake = host();
    fake.placeUnit(`${DIR}/${NEXT}`, body('/usr/bin/someone-else'), { active: true });
    await expect(diffUnit(fake.runner, props, output)).rejects.toThrow(/Nothing was removed/);
  });

  test('a byte-identical file is our own leftover, not a conflict', async () => {
    const fake = host();
    fake.placeUnit(`${DIR}/${NEXT}`, props.content);
    await expect(assertReplaceable(fake.runner, props)).resolves.toBeUndefined();
  });

  test('an unprivileged runner is refused before anything is removed', async () => {
    const fake = fakeLinuxHost({ dirs: { [DIR]: 0 }, euid: 1001 });
    await expect(diffUnit(fake.runner, props, output)).rejects.toThrow(/systemctl needs root/);
  });
});
