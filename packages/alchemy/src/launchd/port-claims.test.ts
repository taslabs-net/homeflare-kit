/**
 * Port collisions, pure and through the engine. Every refusal here happens in the stack's own
 * program (an ordinary `throw` before any resource is even declared), so plan.test.ts's proof for
 * `catalogBinary()` — that the engine never runs a provider or touches a host once the body throws
 * — is re-proved below for `claimPorts`, not assumed to carry over.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { fakeStack } from '../openbao/fake-stack.ts';
import { fakeRunner } from './fake-runner.ts';
import { LaunchdJob } from './job.ts';
import { type PortClaim, PortRefused, claimPorts, portClaimProblems } from './port-claims.ts';
import { launchdProviders } from './providers.ts';
import type { HostRunner } from './runner.ts';

describe('portClaimProblems', () => {
  test.each([
    [
      'a port that is not an integer 1–65535 (too low)',
      [{ owner: 'vector', port: 0 }],
      'port must be an integer from 1 to 65535',
    ],
    [
      'a port that is not an integer 1–65535 (too high)',
      [{ owner: 'vector', port: 65536 }],
      'port must be an integer from 1 to 65535',
    ],
    [
      'a port that is not an integer 1–65535 (fractional)',
      [{ owner: 'vector', port: 9094.5 }],
      'port must be an integer from 1 to 65535',
    ],
    ['an empty owner', [{ owner: '', port: 9094 }], 'has an empty owner'],
    [
      'one owner claiming a port twice',
      [
        { owner: 'vector', port: 9094 },
        { owner: 'vector', port: 9094, address: '127.0.0.1' },
      ],
      'vector claims port 9094 more than once',
    ],
    [
      'two owners on one port, naming both owners and both addresses',
      [
        { owner: 'vector', port: 9094, address: '0.0.0.0' },
        { owner: 'victoria-logs', port: 9094, address: '127.0.0.1' },
      ],
      'port 9094 is claimed by more than one owner: vector (0.0.0.0) and victoria-logs (127.0.0.1)',
    ],
  ] satisfies Array<[string, PortClaim[], string]>)('refuses %s', (_, claims, message) => {
    expect(portClaimProblems(claims).join('; ')).toContain(message);
    expect(() => claimPorts(claims)).toThrow(message);
  });

  test('distinct ports return no problems', () => {
    const claims: PortClaim[] = [
      { owner: 'vector', port: 9094 },
      { owner: 'victoria-logs', port: 9428, address: '127.0.0.1' },
    ];
    expect(portClaimProblems(claims)).toEqual([]);
    expect(() => claimPorts(claims)).not.toThrow();
  });

  // ★ MEASURED (docs/launchd-ports.md): on macOS both of these actually bind — SO_REUSEADDR plus
  //   an address mismatch lets a wildcard and a specific address share one port at the OS level.
  //   The check refuses it anyway: the key is the port NUMBER alone, like lib-ports.nix.
  test('0.0.0.0:9094 against 127.0.0.1:9094 is refused, though the OS would let both bind', () => {
    const problems = portClaimProblems([
      { owner: 'vector', port: 9094, address: '0.0.0.0' },
      { owner: 'victoria-logs', port: 9094, address: '127.0.0.1' },
    ]);
    expect(problems).toEqual([
      'port 9094 is claimed by more than one owner: vector (0.0.0.0) and victoria-logs (127.0.0.1)',
    ]);
  });

  test('claimPorts throws PortRefused carrying the house refusal sentence', () => {
    let caught: unknown;
    try {
      claimPorts([
        { owner: 'a', port: 9094 },
        { owner: 'b', port: 9094 },
      ]);
    } catch (cause) {
      caught = cause;
    }
    expect(caught).toBeInstanceOf(PortRefused);
    expect((caught as Error).message).toMatch(/^Launchd ports: .* Nothing was declared\.$/);
  });
});

describe('through the engine', () => {
  test('a collision fails the plan before any provider or host call', async () => {
    const fake = fakeRunner({ euid: 0 });
    const events: string[] = [];
    const runner: HostRunner = {
      ...fake.runner,
      exec: (argv) => {
        events.push(`exec ${argv.join(' ')}`);
        return fake.runner.exec(argv);
      },
      writeFileAtomic: (path, bytes, options) => {
        events.push(`write ${path}`);
        return fake.runner.writeFileAtomic(path, bytes, options);
      },
    };
    const stack = fakeStack(launchdProviders(runner), {}, 'PortClaimsStack');
    const body = Effect.gen(function* () {
      claimPorts([
        { owner: 'vector', port: 9094 },
        { owner: 'victoria-logs', port: 9094 },
      ]);
      // Never reached: proves the collision is caught before this job — or any provider/host
      // call it would make — runs at all.
      yield* LaunchdJob('never-created', {
        domain: 'system',
        label: 'com.example.never-created',
        programArguments: ['/usr/local/bin/never-created'],
      });
    });
    await expect(stack.deploy(body)).rejects.toThrow('Nothing was declared');
    expect(events).toEqual([]);
  });
});
