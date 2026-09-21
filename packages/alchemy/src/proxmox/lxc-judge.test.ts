/**
 * The pure half of `Proxmox.Lxc`: which spellings are one value, what a change writes, and what is
 * refused — no server. The engine-level tests beside this one prove the same rules survive plan
 * and apply; these pin each rule on its own, with PVE's reason next to it.
 */
import { describe, expect, test } from 'bun:test';
import { TARGET } from './lxc-harness.ts';
import { createForm, createRefusals } from './lxc-create-form.ts';
import { judge } from './lxc-judge.ts';
import { type LxcProps, rawKeysOf, storedConfig } from './lxc-props.ts';
import { judgeVolume, parseVolume, sizeBytes } from './lxc-volume.ts';

const props = (over: Partial<LxcProps>): LxcProps => ({
  node: 'pve1',
  target: TARGET,
  vmid: 100,
  ...over,
});
const live = (config: Record<string, unknown>) => ({ unprivileged: 1, ...config });

describe('sizes and volumes, as pve-container parses them', () => {
  test('parse_size: binary units, bare bytes, and nothing else', () => {
    expect(sizeBytes('40G')).toBe(40 * 1024 ** 3);
    expect(sizeBytes('1.5T')).toBe(1.5 * 1024 ** 4);
    expect(sizeBytes('512M')).toBe(512 * 1024 ** 2);
    expect(sizeBytes('100')).toBe(100);
    expect(sizeBytes('40GB')).toBeUndefined();
  });

  test('classify_mountpoint, plus the new-disk spelling', () => {
    expect(parseVolume('local-zfs:40').kind).toBe('new');
    expect(parseVolume('local-zfs:subvol-1-disk-0,size=40G').kind).toBe('volume');
    expect(parseVolume('/srv/share,mp=/share').kind).toBe('bind');
    expect(parseVolume('/dev/sdb1,mp=/disk').kind).toBe('device');
  });

  test('an options change on a volume declared as new is written with the LIVE volume id', () => {
    const verdict = judgeVolume('mp0', 'tank:200,mp=/data,backup=1', LIVE_MP);
    expect(verdict).toEqual({ put: 'tank:subvol-100-disk-0,mp=/data,backup=1,size=200G' });
  });

  test('a fractional new-disk size grows by the same GiB', () => {
    expect(judgeVolume('mp0', 'tank:200.5,mp=/data', LIVE_MP)).toEqual({ resize: '200.5G' });
  });
});

const LIVE_MP = 'tank:subvol-100-disk-0,mp=/data,backup=0,size=200G';

describe('scalars compare the way PVE stores them', () => {
  test.each([
    [
      'a description PVE handed back with a newline',
      { description: 'hi' },
      { description: 'hi\n' },
    ],
    ['tags in another order and case', { tags: 'B;a' }, { tags: 'a;b' }],
    ['a default PVE leaves out', { onboot: 0, cpulimit: 0, swap: 512 }, {}],
    ['startup with its default key bare', { startup: '1,up=30' }, { startup: 'order=1,up=30' }],
    ['a boolean as true', { protection: true }, { protection: 1 }],
    [
      'features with an off key spelled out',
      { features: 'nesting=1,keyctl=0' },
      { features: 'nesting=1' },
    ],
  ])('%s is no drift', (_, declared, config) => {
    expect(judge(props(declared as Partial<LxcProps>), live(config)).drift).toEqual([]);
  });

  test('cores absent means every host core, which no number is', () => {
    expect(judge(props({ cores: 4 }), live({})).put).toEqual({ cores: '4' });
  });

  test('nameserver order is meaningful', () => {
    const change = judge(props({ nameserver: 'b a' }), live({ nameserver: 'a b' }));
    expect(change.put).toEqual({ nameserver: 'b a' });
  });

  test("'' clears a clearable key and refuses one that cannot be removed", () => {
    expect(judge(props({ description: '' }), live({ description: 'x\n' })).clear).toEqual([
      'description',
    ]);
    expect(judge(props({ hostname: '' }), live({ hostname: 'x' })).refuse[0]).toMatch(
      /cannot be removed/,
    );
  });

  test('a key this resource does not manage is refused, not written', () => {
    const odd = props({}) as unknown as Record<string, unknown>;
    odd['hookscript'] = 'local:snippets/x.sh';
    expect(judge(odd as unknown as LxcProps, live({})).refuse[0]).toMatch(/not a config key/);
  });
});

describe('features follow check_ct_modify_config_perm', () => {
  test('nesting alone on an unprivileged guest is an update', () => {
    expect(judge(props({ features: 'nesting=1' }), live({})).put).toEqual({
      features: 'nesting=1',
    });
  });

  test('any features write on a privileged guest is root@pam only', () => {
    const change = judge(props({ features: 'nesting=1' }), { unprivileged: 0 });
    expect(change.refuse[0]).toMatch(/root@pam/);
    expect(change.put).toEqual({});
  });

  test('clearing features that hold more than nesting is root@pam only, as PVE counts keys', () => {
    const change = judge(props({ features: '' }), live({ features: 'nesting=1,keyctl=0' }));
    expect(change.refuse[0]).toMatch(/pct set 100 --delete features/);
  });
});

describe('NICs and devices', () => {
  test("net '' removes a NIC; a new NIC is added as declared", () => {
    const change = judge(props({ net1: '', net2: 'name=eth2,bridge=vmbr1' }), live({ net1: 'x' }));
    expect(change.clear).toEqual(['net1']);
    expect(change.put).toEqual({ net2: 'name=eth2,bridge=vmbr1' });
  });

  test('a declared MAC is compared, case-insensitively', () => {
    const net = 'name=eth0,bridge=vmbr0,hwaddr=00:00:5E:00:53:01,type=veth';
    expect(judge(props({ net0: net.toLowerCase() }), live({ net0: net })).drift).toEqual([]);
    const other = judge(props({ net0: net.replace(':01', ':09') }), live({ net0: net }));
    expect(other.drift).toEqual(['net0']);
  });

  test("a device with deny-write=0 is the same device; a new one is root@pam's", () => {
    const dev = '/dev/net/tun,deny-write=0';
    expect(judge(props({ dev0: dev }), live({ dev0: '/dev/net/tun' })).drift).toEqual([]);
    expect(judge(props({ dev0: dev }), live({})).refuse[0]).toMatch(/Device passthrough/);
  });
});

describe('create', () => {
  test('the form carries declared keys, drops empties, and sends features without off keys', () => {
    const form = createForm(
      props({
        description: '',
        features: 'nesting=1,keyctl=0',
        ostemplate: 'local:vztmpl/t.tar.zst',
        start: true,
        unprivileged: true,
      }),
    );
    expect(form).toEqual({
      features: 'nesting=1',
      ostemplate: 'local:vztmpl/t.tar.zst',
      start: '1',
      unprivileged: '1',
      vmid: '100',
    });
  });

  test('a privileged create with any feature is refused', () => {
    const refusals = createRefusals(
      props({ features: 'nesting=1', ostemplate: 't', unprivileged: false }),
    );
    expect(refusals.join('\n')).toMatch(/Any feature on a privileged guest/);
  });
});

describe('what state keeps', () => {
  test('never the notes, digest, lock, env or raw lxc values; raw keys by name only', () => {
    const read = {
      description: 'notes a human wrote\n',
      digest: 'd',
      env: 'A=1',
      hostname: 'x',
      lock: 'backup',
      lxc: [['lxc.a', 'v']],
    };
    expect(storedConfig(read)).toEqual({ hostname: 'x' });
    expect(rawKeysOf(read)).toEqual(['lxc.a']);
  });
});
