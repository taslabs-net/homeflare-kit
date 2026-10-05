import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import { createForm, formRefusals, updateForm } from './qemu-form.ts';
import { judge } from './qemu-judge.ts';
import { qemuHandlers } from './qemu-lifecycle.ts';
import { storedConfig } from './qemu-props.ts';

const base = { target: FAKE_TARGET, node: 'n2', vmid: 10000 };
const props = { ...base, nameserver: '10.20.16.254', searchdomain: 'example.internal' };

test('cloud-init DNS survives form rendering, stored attributes and per-key diff', () => {
  const config = { nameserver: props.nameserver, searchdomain: props.searchdomain };
  expect(createForm(props)).toEqual({ ...config, vmid: '10000' });
  expect(updateForm(props)).toEqual(config);
  expect(storedConfig(config)).toEqual(config);
  expect(judge(props, config)).toEqual({ drift: [], put: {}, refuse: [] });
  expect(judge({ ...props, nameserver: '10.20.16.1' }, config)).toEqual({
    drift: ['nameserver'],
    put: { nameserver: '10.20.16.1' },
    refuse: [],
  });
  expect(judge({ ...props, searchdomain: 'new.internal' }, config).put).toEqual({
    searchdomain: 'new.internal',
  });
  expect(judge(base, config).drift).toEqual([]);
});

test('address-list follows PVE: IPs, DNS names, separators and empty lists', () => {
  for (const nameserver of [
    '',
    '10.20.16.254',
    '2001:db8::53',
    'dns.example.internal',
    '10.20.16.254, 2001:db8::53;dns.example.internal',
    '10.20.16.254\0dns.example.internal',
  ]) {
    expect(formRefusals({ ...base, nameserver }), nameserver).toEqual([]);
  }
  for (const nameserver of [
    'https://dns.example',
    '10.20.16.254/24',
    '[2001:db8::53]',
    '-bad.example',
    'bad_.example',
    '2001:db8::broken',
    'dns.example.',
  ]) {
    expect(formRefusals({ ...base, nameserver })[0], nameserver).toContain('address-list');
  }
});

test('invalid DNS fails with a typed refusal before any live read or write', async () => {
  const fake = fakePve(() => {
    throw new Error('unexpected API call');
  });
  await withoutBao(async () => {
    const tag = await Effect.runPromise(
      qemuHandlers
        .diff({
          news: { ...props, nameserver: 'dns://invalid' },
          olds: base,
          output: undefined,
        })
        .pipe(
          Effect.catchTag('QemuRefusedError', (error) => Effect.succeed(error._tag)),
          Effect.provide(fake.layer),
        ),
    );
    expect(tag).toBe('QemuRefusedError');
  });
  expect(fake.calls).toEqual([]);
});
