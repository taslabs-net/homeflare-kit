/**
 * `started: false` against a unit that is `ActiveState=activating` — the timer-driven `Type=oneshot`
 * scenario `isUnitRunning` (unit-form.ts) exists for, and the crash-restart (`auto-restart`)
 * `SubState` that scenario must not be confused with. Split from unit-lifecycle.test.ts to stay
 * under this file's line cap; see that file for the rest of the family's behaviour.
 *
 * ⛔ THE BUG THIS GUARDS: before `isUnitRunning`, `diffUnit` read `ActiveState=activating` on a
 *   `started: false` unit as drift and planned `update`; `settle` then called `systemctl stop` on a
 *   check that was already running, mid-run, driven by its own `.timer`. A redeploy must plan to
 *   nothing while the run is in progress — these tests are that redeploy.
 * ⛔ THE SECOND BUG THAT ALMOST SHIPPED WITH THE FIRST FIX: an `activating` unit whose `SubState`
 *   is `auto-restart` (or `auto-restart-queued`) is systemd's crash-restart backoff, not a start —
 *   see isUnitRunning's own comment. A `started: false` unit that is crash-looping must still be
 *   stopped; the "auto-restart backoff is still drift" test below is that case.
 */
import { describe, expect, test } from 'bun:test';
import { fakeLinuxHost } from './fake-linux-host.ts';
import { type SystemdUnitProps, isUnitRunning, renderUnit } from './unit-form.ts';
import { diffUnit, readUnit, reconcileUnit } from './unit-lifecycle.ts';

const NAME = 'hf-node-check.service';
const PATH = `/etc/systemd/system/${NAME}`;
/** ⛔ No `[Install]`: a timer-driven oneshot is `enabled: false` — its `.timer` starts it, not `systemctl enable`. */
const content = renderUnit([
  { lines: [['Description', 'a PVE node check']], name: 'Unit' },
  {
    lines: [
      ['Type', 'oneshot'],
      ['ExecStart', '/usr/bin/check-node'],
    ],
    name: 'Service',
  },
]);
const props: SystemdUnitProps = { content, enabled: false, name: NAME, started: false };
const host = () => fakeLinuxHost({ dirs: { '/etc/systemd/system': 0 } });
const verbs = (calls: string[][]) =>
  calls.filter((call) => call[0] === 'systemctl').map((call) => call[1]);

/** `readUnit` narrowed to defined, so callers can pass it straight to diffUnit/reconcileUnit. */
const outputFor = async (fake: ReturnType<typeof host>, of: SystemdUnitProps) => {
  const found = await readUnit(fake.runner, of);
  if (found === undefined) throw new Error(`${of.name} not found on the fake host`);
  return found;
};

describe('isUnitRunning — the one predicate diff and settle share', () => {
  test('active always counts as running, whatever started declares', () => {
    expect(isUnitRunning('active', 'running', true)).toBe(true);
    expect(isUnitRunning('active', 'running', false)).toBe(true);
  });
  test('a genuine start counts as running only when started is declared', () => {
    expect(isUnitRunning('activating', 'start', true)).toBe(true);
    expect(isUnitRunning('activating', 'start', false)).toBe(false);
  });
  // ⛔ Added on adversarial review: `auto-restart`/`auto-restart-queued` are ALSO
  //   `ActiveState=activating` (systemd's crash-restart backoff, service.c), not a fresh start —
  //   see isUnitRunning's own comment. Without this, started: false would stop enforcing itself on
  //   exactly the unit most in need of it: one that is crash-looping.
  test('auto-restart backoff always counts as running — it is a crash loop, not a fresh start', () => {
    expect(isUnitRunning('activating', 'auto-restart', false)).toBe(true);
    expect(isUnitRunning('activating', 'auto-restart-queued', false)).toBe(true);
  });
  test('inactive and failed never count as running', () => {
    expect(isUnitRunning('inactive', 'dead', true)).toBe(false);
    expect(isUnitRunning('failed', 'failed', false)).toBe(false);
  });
});

describe('started: false against a oneshot mid-run', () => {
  test('activating, everything else converged: diff is noop', async () => {
    const fake = host();
    fake.placeUnit(PATH, content, { activeState: 'activating', enabled: false, subState: 'start' });
    const output = await outputFor(fake, props);
    expect(await diffUnit(fake.runner, props, output)).toEqual({ action: 'noop' });
  });

  test('active is drift: diff is update, and settle stops it', async () => {
    const fake = host();
    fake.placeUnit(PATH, content, { active: true, enabled: false });
    const output = await outputFor(fake, props);
    expect(await diffUnit(fake.runner, props, output)).toEqual({ action: 'update' });
    const before = fake.calls.length;
    const settled = await reconcileUnit(fake.runner, props, output);
    expect(verbs(fake.calls.slice(before))).toContain('stop');
    expect(settled.active).toBe(false);
  });

  test('activating during an unrelated unit-file update: settle does not stop it', async () => {
    const fake = host();
    fake.placeUnit(PATH, content, { activeState: 'activating', enabled: false, subState: 'start' });
    const output = await outputFor(fake, props);
    const changed = { ...props, content: content.replace('check-node', 'check-node-v2') };
    expect(await diffUnit(fake.runner, changed, output)).toEqual({ action: 'update' });
    const before = fake.calls.length;
    await reconcileUnit(fake.runner, changed, output);
    expect(verbs(fake.calls.slice(before))).not.toContain('stop');
  });

  test('failed is not running either: diff is noop', async () => {
    const fake = host();
    fake.placeUnit(PATH, content, { activeState: 'failed', enabled: false });
    const output = await outputFor(fake, props);
    expect(await diffUnit(fake.runner, props, output)).toEqual({ action: 'noop' });
  });

  // ⛔ ADVERSARIAL-REVIEW CASE: `activating` is not only a fresh start. A unit that was started by
  //   hand and now crash-loops (`Restart=on-failure`) sits in `ActiveState=activating`,
  //   `SubState=auto-restart` for nearly all of its wall-clock time. The oneshot exemption above
  //   must NOT swallow this one — started: false has to keep stopping it, same as plain `active`.
  test('auto-restart backoff is still drift: diff is update, and settle still stops it', async () => {
    const fake = host();
    const crashy = renderUnit([
      { lines: [['Description', 'started by hand, now crash-looping']], name: 'Unit' },
      {
        lines: [
          ['ExecStart', '/usr/bin/flaky'],
          ['Restart', 'on-failure'],
          ['RestartSec', '5'],
        ],
        name: 'Service',
      },
    ]);
    const crashyProps: SystemdUnitProps = {
      content: crashy,
      enabled: false,
      name: NAME,
      started: false,
    };
    fake.placeUnit(PATH, crashy, {
      activeState: 'activating',
      enabled: false,
      subState: 'auto-restart',
    });
    const output = await outputFor(fake, crashyProps);
    expect(await diffUnit(fake.runner, crashyProps, output)).toEqual({ action: 'update' });
    const before = fake.calls.length;
    const settled = await reconcileUnit(fake.runner, crashyProps, output);
    expect(verbs(fake.calls.slice(before))).toContain('stop');
    expect(settled.active).toBe(false);
  });
});

describe('started: true (or omitted) keeps counting activating as running', () => {
  test('no start is issued while the unit is already activating', async () => {
    const fake = host();
    const enabledContent = renderUnit([
      { lines: [['Description', 'a long-running service']], name: 'Unit' },
      { lines: [['ExecStart', '/usr/bin/thing']], name: 'Service' },
      { lines: [['WantedBy', 'multi-user.target']], name: 'Install' },
    ]);
    const started: SystemdUnitProps = { content: enabledContent, name: NAME };
    fake.placeUnit(PATH, enabledContent, {
      activeState: 'activating',
      enabled: true,
      subState: 'start',
    });
    const output = await outputFor(fake, started);
    expect(await diffUnit(fake.runner, started, output)).toEqual({ action: 'noop' });
    const before = fake.calls.length;
    const settled = await reconcileUnit(fake.runner, started, output);
    expect(verbs(fake.calls.slice(before))).not.toContain('start');
    expect(settled.active).toBe(true);
  });
});
