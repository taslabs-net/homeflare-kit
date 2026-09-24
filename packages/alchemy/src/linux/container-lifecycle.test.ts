/**
 * `Podman.Container` against the fake Quadlet host — mirrors `unit-lifecycle.test.ts`'s shape and,
 * like it, cares most about the NEGATIVE assertions: an adopted container that already matches is
 * not restarted, a re-run restarts nothing, and a read that fails writes nothing. Generator-failure
 * rollback and the never-enable guarantee are in container-generator.test.ts; secret refusal is in
 * container-secrets.test.ts; the CT100 fixture is in container-fixture.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { fakeQuadletHost } from './fake-quadlet.ts';
import { type ContainerProps, containerProblems } from './container-form.ts';
import {
  deleteContainer,
  diffContainer,
  readContainer,
  reconcileContainer,
} from './container-lifecycle.ts';

const NAME = 'hf-example';
const PATH = `/etc/containers/systemd/${NAME}.container`;
const SERVICE = `${NAME}.service`;

const props = (image: string): ContainerProps => ({
  container: { image, network: 'host' },
  install: { wantedBy: ['multi-user.target'] },
  name: NAME,
  service: { restart: 'always', restartSec: '5s' },
});

const host = () => fakeQuadletHost();
const verbs = (calls: string[][]) =>
  calls.filter((call) => call[0] === 'systemctl').map((call) => call[1]);

/** `Map#get`, refused instead of `!`-asserted — a missing fixture is a test bug, not a null we hide. */
const must = <V>(map: Map<string, V>, key: string): V => {
  const value = map.get(key);
  if (value === undefined) throw new Error(`test fixture: nothing at ${key}`);
  return value;
};

describe('create', () => {
  test('writes, reloads, verifies the generator and starts — never enables', async () => {
    const fake = host();
    const attrs = await reconcileContainer(fake.runner, props('example/one:1'), undefined);
    expect(attrs).toMatchObject({
      active: true,
      containerPath: PATH,
      name: NAME,
      serviceName: SERVICE,
    });
    expect(verbs(fake.calls)).toEqual(['show', 'daemon-reload', 'show', 'start', 'show']);
    expect(fake.files.get(PATH)?.mode).toBe(0o644);
    expect(fake.files.get(PATH)?.uid).toBe(0);
  });

  test('a start that fails removes the file this deploy wrote and says the unit is down', async () => {
    const fake = host();
    const broken = {
      ...fake.runner,
      exec: async (argv: readonly string[]) =>
        argv[1] === 'start'
          ? { exitCode: 1, stderr: 'Job failed', stdout: '' }
          : fake.runner.exec(argv),
    };
    await expect(reconcileContainer(broken, props('example/one:1'), undefined)).rejects.toThrow(
      /NOT running/,
    );
    expect(fake.files.has(PATH)).toBe(false);
  });
});

describe('adoption', () => {
  /** A fresh fake for the "adopt" half: nothing in state, the file already on disk and generated —
   *  exactly what a container Podman or another deploy started before this stack existed looks like. */
  const adoptedHost = async () => {
    const fake = host();
    await reconcileContainer(fake.runner, props('example/one:1'), undefined);
    const adopting = host();
    adopting.files.set(PATH, must(fake.files, PATH));
    await adopting.runner.exec(['systemctl', 'daemon-reload']); // the fake generator, as on a real host
    must(adopting.units, SERVICE).active = true;
    return adopting;
  };

  test('a live file that already matches is adopted without a restart', async () => {
    const adopting = await adoptedHost();
    const before = adopting.calls.length;
    const attrs = await reconcileContainer(
      adopting.runner,
      props('example/one:1'),
      undefined,
      true,
    );
    expect(attrs).toMatchObject({ active: true, sourcePath: PATH });
    const after = verbs(adopting.calls.slice(before));
    expect(after).not.toContain('restart');
    expect(after).not.toContain('daemon-reload');
  });

  test('and its diff is a noop, so a plan shows nothing to do', async () => {
    const adopting = await adoptedHost();
    const output = await reconcileContainer(
      adopting.runner,
      props('example/one:1'),
      undefined,
      true,
    );
    expect(await diffContainer(adopting.runner, props('example/one:1'), output)).toEqual({
      action: 'noop',
    });
  });

  test('a live file with other content is refused without --adopt', async () => {
    const fake = host();
    await reconcileContainer(fake.runner, props('example/one:1'), undefined);
    const other = host();
    other.files.set(PATH, must(fake.files, PATH));
    await expect(
      reconcileContainer(other.runner, props('example/two:2'), undefined),
    ).rejects.toThrow(/--adopt/);
  });
});

describe('restart happens exactly when something changed', () => {
  test('a changed image restarts once', async () => {
    const fake = host();
    const output = await reconcileContainer(fake.runner, props('example/one:1'), undefined);
    const before = fake.calls.length;
    const next = props('example/two:2');
    expect(await diffContainer(fake.runner, next, output)).toEqual({ action: 'update' });
    const updated = await reconcileContainer(fake.runner, next, output);
    const after = verbs(fake.calls.slice(before));
    expect(after.filter((verb) => verb === 'restart')).toHaveLength(1);
    expect(after).not.toContain('stop');
    expect(updated.active).toBe(true);
  });

  test('a tracked config digest restarts the container without rewriting its file', async () => {
    const fake = host();
    const first = await reconcileContainer(
      fake.runner,
      { ...props('example/one:1'), restartOn: ['aaa'] },
      undefined,
    );
    const next = { ...props('example/one:1'), restartOn: ['bbb'] };
    expect(await diffContainer(fake.runner, next, first)).toEqual({ action: 'update' });
    const before = fake.calls.length;
    await reconcileContainer(fake.runner, next, first);
    const after = fake.calls.slice(before);
    expect(verbs(after)).toContain('restart');
    expect(after.some((call) => call[0] === 'write')).toBe(false);
  });

  test('a re-run with nothing changed restarts nothing at all', async () => {
    const fake = host();
    const output = await reconcileContainer(fake.runner, props('example/one:1'), undefined);
    const before = fake.calls.length;
    await reconcileContainer(fake.runner, props('example/one:1'), output);
    const after = verbs(fake.calls.slice(before));
    expect(after).toEqual(['show', 'show']);
  });

  test('started: false stops a running container and does not restart it', async () => {
    const fake = host();
    const output = await reconcileContainer(fake.runner, props('example/one:1'), undefined);
    const stopped = await reconcileContainer(
      fake.runner,
      { ...props('example/one:1'), started: false },
      output,
    );
    expect(stopped.active).toBe(false);
    expect(verbs(fake.calls)).toContain('stop');
    expect(verbs(fake.calls)).not.toContain('restart');
  });
});

describe('refusals', () => {
  test('an unprivileged runner refuses before it touches anything', async () => {
    const fake = fakeQuadletHost({ euid: 1001 });
    await expect(
      reconcileContainer(fake.runner, props('example/one:1'), undefined),
    ).rejects.toThrow(/never calls sudo/);
    expect(fake.calls).toHaveLength(0);
  });

  test('container.image is required', () => {
    const bad = {
      ...props('example/one:1'),
      container: { ...props('example/one:1').container, image: ' ' },
    };
    expect(containerProblems(bad).join(' ')).toMatch(/image is required/);
  });

  test('a directory outside Quadlet’s search path is refused', () => {
    const elsewhere = { ...props('example/one:1'), directory: '/opt/quadlet' };
    expect(containerProblems(elsewhere).join(' ')).toMatch(/rootful search path/);
  });
});

describe('delete', () => {
  test('stops, removes the file and reloads — never disables', async () => {
    const fake = host();
    const output = await reconcileContainer(fake.runner, props('example/one:1'), undefined);
    const before = fake.calls.length;
    await deleteContainer(fake.runner, output);
    expect(verbs(fake.calls.slice(before))).toEqual(['show', 'stop', 'daemon-reload']);
    expect(fake.files.has(PATH)).toBe(false);
    expect(await readContainer(fake.runner, props('example/one:1'))).toBeUndefined();
  });
});
