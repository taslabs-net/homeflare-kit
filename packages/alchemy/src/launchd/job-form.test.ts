/**
 * LaunchdJob's pure half: domain parsing, the derived plist path, the props → plist mapping, and
 * every refusal in job-validate.ts.
 */
import { describe, expect, test } from 'bun:test';
import {
  type LaunchdJobProps,
  jobPlistDict,
  parseDomain,
  plistPathFor,
  renderJob,
  serviceTarget,
} from './job-form.ts';
import { RESERVED_LABEL_PREFIXES, jobProblems } from './job-validate.ts';

const base: LaunchdJobProps = {
  domain: 'system',
  label: 'com.example.job',
  programArguments: ['/usr/local/bin/job', '--flag'],
};

describe('domains and paths', () => {
  test('system and gui/<uid> parse; anything else does not', () => {
    expect(parseDomain('system')).toEqual({ kind: 'system' });
    expect(parseDomain('gui/501')).toEqual({ kind: 'gui', uid: 501 });
    for (const bad of ['gui/', 'gui/abc', 'user/501', 'System', 'gui/501/x']) {
      expect(parseDomain(bad)).toBeUndefined();
    }
  });

  test('the plist path is derived from label and domain', () => {
    expect(plistPathFor('com.example.job', { kind: 'system' }, undefined)).toBe(
      '/Library/LaunchDaemons/com.example.job.plist',
    );
    expect(plistPathFor('com.example.job', { kind: 'gui', uid: 501 }, '/Users/someone')).toBe(
      '/Users/someone/Library/LaunchAgents/com.example.job.plist',
    );
  });

  test('a gui domain with no home refuses rather than guessing `~`', () => {
    expect(() => plistPathFor('x', { kind: 'gui', uid: 9 }, undefined)).toThrow('no home');
    expect(() => plistPathFor('x', { kind: 'gui', uid: 9 }, 'relative')).toThrow('no home');
  });

  test('service target', () => {
    expect(serviceTarget('com.example.job', 'gui/501')).toBe('gui/501/com.example.job');
  });
});

describe('jobPlistDict', () => {
  test('the minimum is Label and ProgramArguments — no invented defaults', () => {
    expect(jobPlistDict(base)).toEqual({
      Label: 'com.example.job',
      ProgramArguments: ['/usr/local/bin/job', '--flag'],
    });
  });

  test('every typed prop maps to its launchd.plist(5) key', () => {
    expect(
      jobPlistDict({
        ...base,
        environment: { SSL_CERT_FILE: '/etc/ssl/cert.pem' },
        groupName: 'staff',
        keepAlive: { crashed: true, successfulExit: false },
        runAtLoad: true,
        standardErrorPath: '/var/log/job.err',
        standardOutPath: '/var/log/job.out',
        startCalendarInterval: [{ hour: 3, minute: 30 }, { weekday: 0 }],
        startInterval: 300,
        throttleInterval: 30,
        userName: 'nobody',
        workingDirectory: '/var/empty',
        extraKeys: { ProcessType: 'Background' },
      }),
    ).toEqual({
      EnvironmentVariables: { SSL_CERT_FILE: '/etc/ssl/cert.pem' },
      GroupName: 'staff',
      KeepAlive: { Crashed: true, SuccessfulExit: false },
      Label: 'com.example.job',
      ProcessType: 'Background',
      ProgramArguments: ['/usr/local/bin/job', '--flag'],
      RunAtLoad: true,
      StandardErrorPath: '/var/log/job.err',
      StandardOutPath: '/var/log/job.out',
      StartCalendarInterval: [{ Hour: 3, Minute: 30 }, { Weekday: 0 }],
      StartInterval: 300,
      ThrottleInterval: 30,
      UserName: 'nobody',
      WorkingDirectory: '/var/empty',
    });
  });

  test('a single calendar entry stays a dict; keepAlive true stays a boolean; empty env is omitted', () => {
    const dict = jobPlistDict({
      ...base,
      environment: {},
      keepAlive: true,
      startCalendarInterval: { minute: 0 },
    });
    expect(dict['StartCalendarInterval']).toEqual({ Minute: 0 });
    expect(dict['KeepAlive']).toBe(true);
    expect('EnvironmentVariables' in dict).toBe(false);
  });

  test('the digest is stable across key order and changes with any value', () => {
    const one = renderJob({ ...base, environment: { A: '1', B: '2' } });
    const two = renderJob({ ...base, environment: { B: '2', A: '1' } });
    expect(one.sha256).toBe(two.sha256);
    expect(one.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(renderJob({ ...base, runAtLoad: true }).sha256).not.toBe(one.sha256);
    expect(new TextDecoder().decode(one.bytes)).toBe(one.text);
  });
});

describe('jobProblems', () => {
  test('a well-formed job has none', () => {
    expect(jobProblems(base)).toEqual([]);
    expect(
      jobProblems({ ...base, domain: 'gui/501', startCalendarInterval: { weekday: 7 } }),
    ).toEqual([]);
  });

  test.each([
    [
      'a slash in the label (it becomes a file name)',
      { label: 'com.example/../evil' },
      'label must be',
    ],
    ['a leading dot', { label: '.hidden' }, 'label must be'],
    ['an unknown domain', { domain: 'user/501' as never }, 'domain must be'],
    ['no program', { programArguments: [] }, 'must name a program'],
    ['a relative program', { programArguments: ['job'] }, 'absolute path'],
    ['a bad env name', { environment: { 'A-B': 'x' } }, 'not a valid variable name'],
    ['a zero startInterval', { startInterval: 0 }, 'startInterval'],
    ['a fractional throttleInterval', { throttleInterval: 1.5 }, 'throttleInterval'],
    ['an hour of 24', { startCalendarInterval: { hour: 24 } }, 'hour must be 0–23'],
    ['a day of 0', { startCalendarInterval: [{ day: 0 }] }, 'day must be 1–31'],
    ['an empty calendar list', { startCalendarInterval: [] }, 'empty list'],
    ['keepAlive with no condition', { keepAlive: {} }, 'names no condition'],
    [
      'a relative log path',
      { standardOutPath: 'log.txt' },
      'standardOutPath must be an absolute path',
    ],
    [
      'userName on an agent',
      { domain: 'gui/501' as const, userName: 'nobody' },
      'only to the system domain',
    ],
    ['extraKeys naming a typed key', { extraKeys: { KeepAlive: true } }, 'extraKeys.KeepAlive'],
    ['extraKeys naming Program', { extraKeys: { Program: '/bin/x' } }, 'extraKeys.Program'],
    ['a secret-looking env var', { environment: { API_TOKEN: 'x' } }, 'unencrypted'],
  ])('refuses %s', (_name, patch, message) => {
    expect(jobProblems({ ...base, ...patch } as LaunchdJobProps).join('\n')).toContain(message);
  });

  test.each(RESERVED_LABEL_PREFIXES.map((prefix) => [prefix]))(
    'refuses labels under %s',
    (prefix) => {
      expect(jobProblems({ ...base, label: `${prefix}job` }).join('\n')).toContain(
        'another tool owns',
      );
    },
  );

  test('reports every problem at once, so one plan shows the whole list', () => {
    expect(
      jobProblems({ ...base, label: '/x', programArguments: ['rel'], startInterval: -1 }).length,
    ).toBe(3);
  });
});
