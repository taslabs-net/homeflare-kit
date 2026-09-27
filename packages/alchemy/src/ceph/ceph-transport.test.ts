/**
 * The mon-command transport against `fakeCephDial` — no ssh, no spawned process. Mon-transport doc
 * acceptance tests #1 ("no ssh at all" for a refused shape) and #2 (try-in-order, transport
 * failure never reads as absent, quorum re-checked on a fresh connection after a write).
 */
import { describe, expect, test } from 'bun:test';
import { authGetArgv, quorumStatusArgv } from './ceph-argv.ts';
import { assertFreshQuorum, runCephCommand } from './ceph-transport.ts';
import { fakeCephDial, fakeCephOk } from './fake-ceph-dial.ts';

const ENTITY = 'client.k8s-rbd';
const MON_A = 'mon-a.example.test';
const MON_B = 'mon-b.example.test';
const MON_C = 'mon-c.example.test';

describe('runCephCommand', () => {
  test('a refused shape never dials — no mon is ever contacted', async () => {
    const fake = fakeCephDial({});
    await expect(
      runCephCommand({ dial: fake.dial, log: () => {}, nodes: [MON_A] }, [
        '/usr/bin/ceph',
        'auth',
        'del',
        ENTITY,
        '-f',
        'json',
      ]),
    ).rejects.toThrow(/never auto-delete/);
    expect(fake.seen).toEqual([]);
  });

  test('refuses when no mon nodes are declared, without dialing', async () => {
    const fake = fakeCephDial({});
    await expect(
      runCephCommand({ dial: fake.dial, log: () => {}, nodes: [] }, authGetArgv(ENTITY)),
    ).rejects.toThrow(/no mon nodes/);
    expect(fake.seen).toEqual([]);
  });

  test('tries the next mon on a transport failure, in order, and returns the first that answers', async () => {
    const fake = fakeCephDial({
      [MON_B]: [{ kind: 'result', result: { exitCode: 0, stderr: '', stdout: '[]' } }],
    });
    const result = await runCephCommand(
      { dial: fake.dial, log: () => {}, nodes: [MON_A, MON_B, MON_C] },
      authGetArgv(ENTITY),
    );
    expect(result.node).toBe(MON_B);
    expect(fake.seen.map((call) => call.node)).toEqual([MON_A, MON_B]);
  });

  test('every mon failing at the transport layer propagates as an error, never as absent', async () => {
    const fake = fakeCephDial({});
    const attempt = runCephCommand(
      { dial: fake.dial, log: () => {}, nodes: [MON_A, MON_B] },
      authGetArgv(ENTITY),
    );
    await expect(attempt).rejects.toThrow(/every mon node failed \(never treated as absent\)/);
    expect(fake.seen.map((call) => call.node)).toEqual([MON_A, MON_B]);
  });

  test('a mon that actually answers, even with a nonzero exit, is not retried on another node', async () => {
    const fake = fakeCephDial({
      [MON_A]: [
        { kind: 'result', result: { exitCode: 2, stderr: 'Error ENOENT: not found', stdout: '' } },
      ],
    });
    const result = await runCephCommand(
      { dial: fake.dial, log: () => {}, nodes: [MON_A, MON_B] },
      authGetArgv(ENTITY),
    );
    expect(result.node).toBe(MON_A);
    expect(result.exitCode).toBe(2);
    expect(fake.seen.map((call) => call.node)).toEqual([MON_A]);
  });

  test('the log line carries the argv, never any result — including a successful stdout', async () => {
    const lines: string[] = [];
    const fake = fakeCephDial({
      [MON_A]: [
        fakeCephOk('[{"entity":"client.k8s-rbd","key":"fake-key-not-a-secret","caps":{}}]'),
      ],
    });
    await runCephCommand(
      { dial: fake.dial, log: (line) => lines.push(line), nodes: [MON_A] },
      authGetArgv(ENTITY),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(JSON.stringify(authGetArgv(ENTITY)));
    expect(lines.join('\n')).not.toContain('fake-key-not-a-secret');
  });
});

describe('assertFreshQuorum', () => {
  test('passes on a healthy quorum', async () => {
    const fake = fakeCephDial({ [MON_A]: [fakeCephOk('{"quorum":[0,1,2]}')] });
    await expect(
      assertFreshQuorum({ dial: fake.dial, log: () => {}, nodes: [MON_A] }),
    ).resolves.toBeUndefined();
    expect(fake.seen).toEqual([{ argv: quorumStatusArgv(), node: MON_A }]);
  });

  test('fails closed on an empty quorum array', async () => {
    const fake = fakeCephDial({ [MON_A]: [fakeCephOk('{"quorum":[]}')] });
    await expect(
      assertFreshQuorum({ dial: fake.dial, log: () => {}, nodes: [MON_A] }),
    ).rejects.toThrow(/degraded/);
  });

  test('fails closed on unparseable output — never calls a guess "healthy"', async () => {
    const fake = fakeCephDial({ [MON_A]: [fakeCephOk('not json')] });
    await expect(
      assertFreshQuorum({ dial: fake.dial, log: () => {}, nodes: [MON_A] }),
    ).rejects.toThrow(/degraded/);
  });

  test('a nonzero exit from quorum_status itself fails, reporting stderr only', async () => {
    const fake = fakeCephDial({
      [MON_A]: [{ kind: 'result', result: { exitCode: 1, stderr: 'mon down', stdout: '' } }],
    });
    await expect(
      assertFreshQuorum({ dial: fake.dial, log: () => {}, nodes: [MON_A] }),
    ).rejects.toThrow(/mon down/);
  });
});
