/**
 * The mount-point and key-set rules an adversarial review found unpinned (2026-09-21): each test
 * here failed against a mutant of the rule it names.
 *
 * ⛔ WHAT THESE PIN: another volume on the same storage is refused (a PUT of it would detach the
 *   live one to unusedN); a bind or device mount is root@pam's whether new or changed; `replicate`
 *   defaults ON; an options change that also grows writes the LIVE size; a key the resource does
 *   not manage never reaches a create body; and state keeps managed keys only.
 */
import { describe, expect, test } from 'bun:test';
import { TARGET } from './lxc-harness.ts';
import { createRefusals } from './lxc-create-form.ts';
import { judge } from './lxc-judge.ts';
import { type LxcProps, storedConfig } from './lxc-props.ts';
import { judgeVolume } from './lxc-volume.ts';

const LIVE_MP = 'tank:subvol-100-disk-0,mp=/data,size=200G';
const props = (over: Record<string, unknown>): LxcProps =>
  ({ node: 'pve1', target: TARGET, vmid: 100, ...over }) as unknown as LxcProps;
const live = (config: Record<string, unknown>) => ({ unprivileged: 1, ...config });

describe('mount points', () => {
  test('another volume on the same storage is refused, never written', () => {
    const verdict = judgeVolume('mp0', 'tank:subvol-100-disk-7,mp=/data,size=200G', LIVE_MP);
    expect(verdict.refuse).toMatch(/detach the live volume to unusedN/);
    expect(verdict.put).toBeUndefined();
    const change = judge(props({ mp0: 'tank:subvol-100-disk-7,mp=/data' }), live({ mp0: LIVE_MP }));
    expect(change.put).toEqual({});
    expect(change.refuse[0]).toMatch(/unusedN/);
  });

  test('a bind mount is root@pam only, new or changed', () => {
    const added = judge(props({ mp1: '/srv/share,mp=/share' }), live({}));
    expect(added.put).toEqual({});
    expect(added.refuse[0]).toMatch(/pct set 100 --mp1/);
    const bind = '/srv/share,mp=/share';
    expect(judgeVolume('mp1', `${bind},ro=1`, bind)).toEqual({ rootOnly: true });
    expect(judgeVolume('mp1', bind, bind)).toEqual({});
  });

  test('replicate defaults ON: an explicit replicate=0 is a value, replicate=1 is not', () => {
    expect(judgeVolume('mp0', `${LIVE_MP},replicate=1`, LIVE_MP)).toEqual({});
    const off = judgeVolume('mp0', LIVE_MP, `${LIVE_MP},replicate=0`);
    expect(off.put).toBe('tank:subvol-100-disk-0,mp=/data,size=200G');
  });

  test('options and growth together: the PUT carries the live size, the resize the new one', () => {
    const verdict = judgeVolume('mp0', 'tank:300,mp=/data,backup=1', LIVE_MP);
    expect(verdict).toEqual({
      put: 'tank:subvol-100-disk-0,mp=/data,backup=1,size=200G',
      resize: '300G',
    });
  });
});

describe('a create allocates new volumes only', () => {
  test('an existing volume id in a create is refused; the new-disk spelling is not', () => {
    const base = { ostemplate: 'local:vztmpl/t.tar.zst' };
    const existing = createRefusals(
      props({ ...base, rootfs: 'local-zfs:subvol-100-disk-0,size=8G' }),
    );
    expect(existing.join('\n')).toMatch(/rootfs: .* names an existing volume/);
    expect(
      createRefusals(props({ ...base, mp0: 'tank:8,mp=/data', rootfs: 'local-zfs:8' })),
    ).toEqual([]);
  });
});

describe('keys the resource does not manage', () => {
  test.each([['password'], ['force'], ['restore'], ['hookscript']])(
    '%s is refused at create, so it is never POSTed',
    (key) => {
      const refusals = createRefusals(props({ [key]: '1', ostemplate: 'local:vztmpl/t.tar.zst' }));
      expect(refusals.join('\n')).toContain(`${key}: not a config key this resource manages`);
    },
  );

  test('state keeps managed keys only: a new PVE key is not stored until it is managed', () => {
    const read = {
      entrypoint: '/usr/bin/app --token=placeholder',
      hookscript: 'local:snippets/x.sh',
      hostname: 'x',
      memory: 512,
      mp0: LIVE_MP,
      parent: 'snap1',
      unprivileged: 1,
      unused0: 'tank:subvol-100-disk-9',
    };
    expect(storedConfig(read)).toEqual({
      hostname: 'x',
      memory: '512',
      mp0: LIVE_MP,
      unprivileged: '1',
    });
  });
});
