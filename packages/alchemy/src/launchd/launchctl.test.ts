/**
 * The launchctl parsers against the shapes measured on macOS 27.2 (launchctl.ts header), and the
 * bootout sequence against the fake launchd.
 *
 * ★ The fixture keeps the two traps from the real output: a multi-line shell argument that prints
 *   raw (with a `}` in column 0), and nested blocks that repeat `state = ` two tabs deep.
 */
import { describe, expect, test } from 'bun:test';
import { fakeRunner } from './fake-runner.ts';
import {
  LAUNCHCTL,
  bootoutIfLoaded,
  parseDisabled,
  parsePrint,
  printFields,
  printService,
} from './launchctl.ts';

const RUNNING = [
  'system/com.example.job = {',
  '\tactive count = 1',
  '\tpath = /Library/LaunchDaemons/com.example.job.plist',
  '\ttype = LaunchDaemon',
  '\tstate = running',
  '',
  '\tprogram = /bin/sh',
  '\targuments = {',
  '\t\t/bin/sh',
  '\t\t-c',
  '\t\tprog=/opt/example/bin/job',
  '[ -x "$prog" ] || {',
  '  pid = 99',
  '}',
  'exec "$prog"',
  '',
  '\t}',
  '',
  '\tstdout path = /var/log/example.log',
  '\tresource coalition = {',
  '\t\tID = 777',
  '\t\ttype = resource',
  '\t\tstate = active',
  '\t}',
  '',
  '\tdomain = system',
  '\truns = 1',
  '\tpid = 1219',
  '\tlast exit code = (never exited)',
  '\tspawn type = daemon (3)',
  '\tjob state = running',
  '}',
].join('\n');

describe('printFields / parsePrint', () => {
  test('reads the job block, not the nested blocks or the raw argument text', () => {
    const fields = printFields(RUNNING);
    expect(fields.get('state')).toBe('running');
    expect(fields.get('pid')).toBe('1219');
    expect(fields.get('type')).toBe('LaunchDaemon');
    expect(fields.get('path')).toBe('/Library/LaunchDaemons/com.example.job.plist');
    expect(fields.has('ID')).toBe(false);
  });

  test('a running job', () => {
    expect(parsePrint(RUNNING)).toEqual({ loaded: true, pid: 1219, state: 'running' });
  });

  test('a stopped job with an exit code, and the newer "78: EX_CONFIG" form', () => {
    const stopped = RUNNING.replace('\tstate = running', '\tstate = not running')
      .replace('\tpid = 1219\n', '')
      .replace('(never exited)', '78: EX_CONFIG');
    expect(parsePrint(stopped)).toEqual({ lastExitCode: 78, loaded: true, state: 'not running' });
    expect(parsePrint(stopped.replace('78: EX_CONFIG', '0')).lastExitCode).toBe(0);
  });

  test('empty output parses to loaded with no details (the caller decides loaded from the exit code)', () => {
    expect(parsePrint('')).toEqual({ loaded: true });
  });
});

describe('parseDisabled', () => {
  test('the measured `=> enabled|disabled` form, and the older `=> true|false`', () => {
    const out = [
      '\tdisabled services = {',
      '\t\t"com.example.on" => enabled',
      '\t\t"com.example.off" => disabled',
      '\t\t"com.example.legacy-off" => true',
      '\t\t"com.example.legacy-on" => false',
      '\t}',
    ].join('\n');
    expect([...parseDisabled(out)].sort()).toEqual(['com.example.legacy-off', 'com.example.off']);
  });
});

describe('printService', () => {
  test('exit 113 is "not loaded", not an error', async () => {
    const fake = fakeRunner();
    expect(await printService(fake.runner, 'system/com.example.none')).toEqual({ loaded: false });
  });

  test('any other non-zero exit is an error carrying stderr, never stdout', async () => {
    const runner = {
      ...fakeRunner().runner,
      exec: async () => ({ exitCode: 1, stderr: 'Bad request.', stdout: 'SECRET_ENV=leak' }),
    };
    const error = await printService(runner, 'system/x').then(
      () => new Error('expected a rejection'),
      (cause: unknown) => cause as Error,
    );
    expect(error.message).toContain('Bad request.');
    expect(error.message).not.toContain('leak');
  });
});

describe('bootoutIfLoaded', () => {
  test('does nothing when the job is not loaded (bootout of an absent job exits non-zero)', async () => {
    const fake = fakeRunner();
    await bootoutIfLoaded(fake.runner, 'system/com.example.none');
    expect(fake.calls.map((call) => call[1])).toEqual(['print']);
  });

  test('boots out, then polls until launchd lets go', async () => {
    const fake = fakeRunner();
    fake.loaded.set('system/com.example.job', 1);
    fake.state.lingerPrints = 3;
    await bootoutIfLoaded(fake.runner, 'system/com.example.job');
    expect(fake.loaded.has('system/com.example.job')).toBe(false);
    const subs = fake.calls.map((call) => call[1]);
    expect(subs.slice(0, 2)).toEqual(['print', 'bootout']);
    expect(subs.filter((sub) => sub === 'print').length).toBeGreaterThan(3);
    expect(fake.calls.every((call) => call[0] === LAUNCHCTL)).toBe(true);
  });

  test('gives up with a clear error when the job never goes away', async () => {
    const fake = fakeRunner();
    fake.loaded.set('system/com.example.stuck', 1);
    fake.state.lingerPrints = 1_000;
    await expect(bootoutIfLoaded(fake.runner, 'system/com.example.stuck')).rejects.toThrow(
      'still loaded',
    );
  });
});
