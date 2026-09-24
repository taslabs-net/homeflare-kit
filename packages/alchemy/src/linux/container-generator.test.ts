/**
 * The two things container-generator.ts's header stakes the whole design on:
 *
 * 1. A generator failure never reads as "the resource is absent" — it is a typed, loud
 *    `QuadletGeneratorError`, and an UPDATE that fails restores the last-known-good `.container`
 *    file and reloads again, so a container that was already running never loses its systemd unit.
 * 2. `enable`/`disable` is never even ATTEMPTED on the generated unit — the fake fails the call
 *    (fake-quadlet.ts), so a regression that reintroduced one would fail loudly here, not silently
 *    no-op the way a plain assertion-of-absence would.
 */
import { describe, expect, test } from 'bun:test';
import { FAIL_GENERATOR_MARKER, fakeQuadletHost } from './fake-quadlet.ts';
import { type ContainerProps, digestOf, renderContainerFile } from './container-form.ts';
import { deleteContainer, reconcileContainer } from './container-lifecycle.ts';
import { QuadletGeneratorError, verifyGenerated } from './container-generator.ts';

const NAME = 'hf-example';
const PATH = `/etc/containers/systemd/${NAME}.container`;
const SERVICE = `${NAME}.service`;

const props = (image: string): ContainerProps => ({
  container: { image, network: 'host' },
  install: { wantedBy: ['multi-user.target'] },
  name: NAME,
});

const broken: ContainerProps = {
  ...props('example/one:1'),
  service: { lines: [['X-Test-Fail-Generator', '1']] },
};

const verbs = (calls: string[][]) =>
  calls.filter((call) => call[0] === 'systemctl').map((call) => call[1]);

test('the fixture marker really does render into the file', () => {
  expect(renderContainerFile(broken)).toContain(FAIL_GENERATOR_MARKER);
});

describe('a generator failure is a typed, loud error', () => {
  test('a CREATE the generator refuses removes the file it wrote and reloads clean', async () => {
    const fake = fakeQuadletHost();
    await expect(reconcileContainer(fake.runner, broken, undefined)).rejects.toThrow(
      QuadletGeneratorError,
    );
    expect(fake.files.has(PATH)).toBe(false);
    expect(verbs(fake.calls)).toEqual(['show', 'daemon-reload', 'show', 'daemon-reload']);
  });

  test('an UPDATE the generator refuses restores the last-known-good file, not the broken one', async () => {
    const fake = fakeQuadletHost();
    const good = await reconcileContainer(fake.runner, props('example/one:1'), undefined);
    const goodBytes = fake.files.get(PATH)?.bytes;
    const before = fake.calls.length;
    await expect(reconcileContainer(fake.runner, broken, good)).rejects.toThrow(
      QuadletGeneratorError,
    );
    // ★ THE FILE ON DISK IS THE OLD, WORKING ONE — not the broken update.
    expect(fake.files.get(PATH)?.bytes).toEqual(goodBytes);
    // ★ AND THE GENERATED UNIT EXISTS AGAIN, still the container that was already running.
    expect(fake.units.get(SERVICE)?.active).toBe(true);
    expect(verbs(fake.calls.slice(before))).toEqual([
      'show',
      'daemon-reload',
      'show',
      'daemon-reload',
    ]);
  });

  test('a file already on disk that the generator refuses is not "rolled back" onto itself', async () => {
    // ⚠️ wrote === false: nothing NEW to restore to (container-lifecycle.ts's header explains why).
    const fake = fakeQuadletHost();
    fake.files.set(PATH, {
      bytes: new TextEncoder().encode(renderContainerFile(broken)),
      gid: 0,
      kind: 'file',
      mode: 0o644,
      uid: 0,
    });
    await expect(reconcileContainer(fake.runner, broken, undefined, true)).rejects.toThrow(
      QuadletGeneratorError,
    );
    // Only the one read-only `show` that found nothing generated — no write, no reload attempted.
    expect(verbs(fake.calls)).toEqual(['show']);
  });
});

describe('enable/disable is never attempted on a generated unit', () => {
  test('create, update and delete never call enable or disable', async () => {
    const fake = fakeQuadletHost();
    const first = await reconcileContainer(fake.runner, props('example/one:1'), undefined);
    const second = await reconcileContainer(fake.runner, props('example/two:2'), first);
    await deleteContainer(fake.runner, second);
    expect(verbs(fake.calls)).not.toContain('enable');
    expect(verbs(fake.calls)).not.toContain('disable');
  });

  test('the fake itself refuses enable, proving the guard is real and not just unexercised', async () => {
    const fake = fakeQuadletHost();
    const result = await fake.runner.exec(['systemctl', 'enable', '--', SERVICE]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/transient or was generated/);
  });
});

describe('an interrupted apply that crashed before daemon-reload', () => {
  test('the retry still reloads and restarts onto the NEW definition, not the stale one', async () => {
    const fake = fakeQuadletHost();
    const oldProps = props('example/old:1');
    const newProps = props('example/new:2');
    const oldOutput = await reconcileContainer(fake.runner, oldProps, undefined);
    // ★ Simulate apply 1: its write landed, but it crashed before `daemon-reload` ran, so the
    //   generated unit is still the OLD one, and Alchemy's state is still `oldOutput` — a reconcile
    //   that never returns never gets its attributes persisted.
    fake.files.set(PATH, {
      bytes: new TextEncoder().encode(renderContainerFile(newProps)),
      gid: 0,
      kind: 'file',
      mode: 0o644,
      uid: 0,
    });
    const before = fake.calls.length;
    const retried = await reconcileContainer(fake.runner, newProps, oldOutput);
    const after = verbs(fake.calls.slice(before));
    // ⛔ THE BUG THIS PROVES FIXED: without the `stale` check, `wrote` is false (the file already
    //   holds the new content) and systemd's own `NeedDaemonReload` is also false (the GENERATED
    //   unit hasn't changed yet), so nothing would ever reload — the container would restart, if at
    //   all, onto its OLD definition while state silently claimed the new one had taken effect.
    expect(after).toContain('daemon-reload');
    expect(after).toContain('restart');
    const newDigest = digestOf(renderContainerFile(newProps));
    expect(retried.containerSha256).toBe(newDigest);
    // ★ Not just a claim in state: the fake's OWN generated-unit record is built from the NEW file.
    expect(fake.units.get(SERVICE)?.loadedSha).toBe(newDigest);
  });
});

describe('verifyGenerated, directly', () => {
  test('a missing generated unit is a QuadletGeneratorError naming the debug commands', () => {
    expect(() =>
      verifyGenerated(NAME, PATH, SERVICE, {
        activeState: 'inactive',
        known: false,
        loadState: 'not-found',
        needDaemonReload: false,
      }),
    ).toThrow(/podman-system-generator --dryrun/);
  });

  test('a SourcePath belonging to another file is a takeover, not a success', () => {
    expect(() =>
      verifyGenerated(NAME, PATH, SERVICE, {
        activeState: 'active',
        known: true,
        loadState: 'loaded',
        needDaemonReload: false,
        sourcePath: '/usr/share/containers/systemd/hf-example.container',
      }),
    ).toThrow(/earlier in Quadlet/);
  });
});
