/**
 * The systemd family against the fake host. ⛔ The assertions that matter here are the NEGATIVE
 *   ones: an adopted unit that already matches is not restarted, a re-run restarts nothing, and a
 *   read that fails writes nothing. An estate rebuild must be able to reach a host holding a vault
 *   or a clock without bouncing it.
 */
import { describe, expect, test } from 'bun:test';
import { fakeLinuxHost } from './fake-linux-host.ts';
import { statusOf } from './systemctl.ts';
import { renderUnit, unitProblems } from './unit-form.ts';
import { deleteUnit, diffUnit, readUnit, reconcileUnit } from './unit-lifecycle.ts';

const NAME = 'hf-example.service';
const PATH = `/etc/systemd/system/${NAME}`;
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
const host = () => fakeLinuxHost({ dirs: { '/etc/systemd/system': 0 } });
const verbs = (calls: string[][]) =>
  calls.filter((call) => call[0] === 'systemctl').map((call) => call[1]);

describe('create', () => {
  test('writes, reloads, enables and starts — in that order', async () => {
    const fake = host();
    const attrs = await reconcileUnit(fake.runner, props, undefined);
    expect(attrs).toMatchObject({ active: true, enabled: true, name: NAME, unitPath: PATH });
    expect(verbs(fake.calls)).toEqual(['show', 'daemon-reload', 'enable', 'start', 'show']);
    expect(fake.files.get(PATH)?.mode).toBe(0o644);
    expect(fake.files.get(PATH)?.uid).toBe(0);
  });

  test('a start that fails removes the file this deploy wrote and says the unit is down', async () => {
    const fake = fakeLinuxHost({ dirs: { '/etc/systemd/system': 0 } });
    const broken = {
      ...fake.runner,
      exec: async (argv: readonly string[]) =>
        argv[1] === 'start'
          ? { exitCode: 1, stderr: 'Job failed', stdout: '' }
          : fake.runner.exec(argv),
    };
    await expect(reconcileUnit(broken, props, undefined)).rejects.toThrow(/NOT running/);
    expect(fake.files.has(PATH)).toBe(false);
  });
});

describe('adoption', () => {
  test('a live unit that already matches is adopted without a restart', async () => {
    const fake = host();
    fake.placeUnit(PATH, props.content, { active: true, enabled: true });
    const before = fake.calls.length;
    const attrs = await reconcileUnit(fake.runner, props, undefined, true);
    expect(attrs).toMatchObject({ active: true, enabled: true });
    const after = verbs(fake.calls.slice(before));
    expect(after).toEqual(['show', 'show']);
    expect(after).not.toContain('restart');
    expect(after).not.toContain('daemon-reload');
  });

  test('and its diff is a noop, so a plan shows nothing to do', async () => {
    const fake = host();
    fake.placeUnit(PATH, props.content, { active: true, enabled: true });
    const output = await reconcileUnit(fake.runner, props, undefined, true);
    expect(await diffUnit(fake.runner, props, output)).toEqual({ action: 'noop' });
  });

  test('a live unit with other content is refused without --adopt', async () => {
    const fake = host();
    fake.placeUnit(PATH, body('/usr/bin/something-else'), { active: true, enabled: true });
    await expect(reconcileUnit(fake.runner, props, undefined)).rejects.toThrow(/--adopt/);
  });
});

describe('restart happens exactly when something changed', () => {
  test('a changed unit file restarts once', async () => {
    const fake = host();
    fake.placeUnit(PATH, body('/usr/bin/old'), { active: true, enabled: true });
    const output = await reconcileUnit(fake.runner, props, undefined, true);
    const before = fake.calls.length;
    const next = { ...props, content: body('/usr/bin/new') };
    expect(await diffUnit(fake.runner, next, output)).toEqual({ action: 'update' });
    const updated = await reconcileUnit(fake.runner, next, output);
    const after = verbs(fake.calls.slice(before));
    expect(after.filter((verb) => verb === 'restart')).toHaveLength(1);
    expect(after).not.toContain('stop');
    expect(updated.active).toBe(true);
  });

  test('a tracked config digest restarts the unit without rewriting its file', async () => {
    const fake = host();
    const first = await reconcileUnit(fake.runner, { ...props, restartOn: ['aaa'] }, undefined);
    const next = { ...props, restartOn: ['bbb'] };
    expect(await diffUnit(fake.runner, next, first)).toEqual({ action: 'update' });
    const before = fake.calls.length;
    await reconcileUnit(fake.runner, next, first);
    const after = fake.calls.slice(before);
    expect(verbs(after)).toContain('restart');
    expect(after.some((call) => call[0] === 'write')).toBe(false);
  });

  test('a re-run with nothing changed restarts nothing at all', async () => {
    const fake = host();
    const output = await reconcileUnit(fake.runner, props, undefined);
    const before = fake.calls.length;
    await reconcileUnit(fake.runner, props, output);
    const after = verbs(fake.calls.slice(before));
    expect(after).toEqual(['show', 'show']);
  });

  test('started: false stops a running unit and does not restart it', async () => {
    const fake = host();
    fake.placeUnit(PATH, props.content, { active: true, enabled: true });
    const output = await reconcileUnit(fake.runner, props, undefined, true);
    const stopped = await reconcileUnit(fake.runner, { ...props, started: false }, output);
    expect(stopped.active).toBe(false);
    expect(verbs(fake.calls)).toContain('stop');
    expect(verbs(fake.calls)).not.toContain('restart');
  });
});

describe('refusals', () => {
  test('a read that fails refuses and writes nothing', async () => {
    const fake = fakeLinuxHost({ dirs: { '/etc/systemd/system': 0 }, failShow: true });
    await expect(reconcileUnit(fake.runner, props, undefined)).rejects.toThrow(/systemctl show/);
    expect(fake.files.has(PATH)).toBe(false);
    expect(verbs(fake.calls)).not.toContain('daemon-reload');
  });

  test('a masked unit is someone’s decision, not drift', async () => {
    const fake = host();
    fake.placeUnit(PATH, props.content, { masked: true });
    await expect(reconcileUnit(fake.runner, props, undefined, true)).rejects.toThrow(/is masked/);
  });

  test('an unprivileged runner refuses before it touches anything', async () => {
    const fake = fakeLinuxHost({ dirs: { '/etc/systemd/system': 0 }, euid: 1001 });
    await expect(reconcileUnit(fake.runner, props, undefined)).rejects.toThrow(/never calls sudo/);
    expect(fake.calls).toHaveLength(0);
  });

  test('an enabled unit with no [Install] is refused at validation, not at systemctl', () => {
    const noInstall = {
      content: '[Unit]\nDescription=x\n[Service]\nExecStart=/bin/true\n',
      name: NAME,
    };
    expect(unitProblems(noInstall).join(' ')).toMatch(/\[Install\]/);
    expect(unitProblems({ ...noInstall, enabled: false })).toEqual([]);
  });

  test('a timer resource refuses a .service, and a .timer needs a [Timer] section', () => {
    expect(unitProblems(props, 'timer').join(' ')).toMatch(/is a \.service/);
    expect(unitProblems({ content: props.content, name: 'x.timer' }, 'timer').join(' ')).toMatch(
      /\[Timer\]/,
    );
  });

  test('an enabled unit outside systemd’s search path is refused at plan time', () => {
    // ⛔ `systemctl enable` looks a unit up BY NAME; a file in /opt is invisible to that lookup,
    //   so without this the deploy writes the file, reloads, and only then fails.
    const elsewhere = { ...props, directory: '/opt/app/units' };
    expect(unitProblems(elsewhere).join(' ')).toMatch(/where systemd looks for it by name/);
    expect(unitProblems({ ...elsewhere, enabled: false })).toEqual([]);
    expect(unitProblems({ ...props, directory: '/usr/local/lib/systemd/system' })).toEqual([]);
  });

  test('an enable that systemd did not honour is a refusal, not a claim in state', async () => {
    const fake = host();
    const lying = {
      ...fake.runner,
      exec: async (argv: readonly string[]) =>
        argv[1] === 'enable' ? { exitCode: 0, stderr: '', stdout: '' } : fake.runner.exec(argv),
    };
    await expect(reconcileUnit(lying, props, undefined)).rejects.toThrow(/not enabled/);
  });

  test('both or neither of content and sections is a refusal', () => {
    expect(unitProblems({ name: NAME }).join(' ')).toMatch(/exactly one of content or sections/);
  });
});

describe('delete', () => {
  test('stops, disables, removes the file and reloads', async () => {
    const fake = host();
    const output = await reconcileUnit(fake.runner, props, undefined);
    const before = fake.calls.length;
    await deleteUnit(fake.runner, output);
    expect(verbs(fake.calls.slice(before))).toEqual(['show', 'stop', 'disable', 'daemon-reload']);
    expect(fake.files.has(PATH)).toBe(false);
    expect(await readUnit(fake.runner, props)).toBeUndefined();
  });
});

describe('systemctl show, as measured', () => {
  test('a unit that does not exist answers, and the answer is LoadState', () => {
    // MEASURED 2026-09-22, Debian 13 / systemd 257: exit 0, LoadState=not-found.
    const status = statusOf(
      'Id=absent.service\nLoadState=not-found\nActiveState=inactive\nSubState=dead\n' +
        'FragmentPath=\nUnitFileState=\nNeedDaemonReload=no\n',
    );
    expect(status).toMatchObject({ known: false, loadState: 'not-found' });
  });

  test('a real unit parses whatever order systemd prints', () => {
    const status = statusOf(
      'ExecStart={ path=/usr/sbin/sshd ; argv[]=/usr/sbin/sshd -D $SSHD_OPTS }\n' +
        'Description=OpenBSD Secure Shell server\nLoadState=loaded\nUnitFileState=enabled\n',
    );
    expect(status).toMatchObject({ known: true, loadState: 'loaded', unitFileState: 'enabled' });
  });
});
