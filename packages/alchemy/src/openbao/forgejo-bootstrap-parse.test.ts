import { describe, expect, test } from 'bun:test';
import {
  readCreateOutput,
  runningForgejoBinary,
  usernamesFrom,
} from './forgejo-bootstrap-parse.ts';

const NIX = '/nix/store/2wagmmlb09s2r0gv839iwmdvrc18kg8h-forgejo-16.0.3/bin/forgejo';

describe('runningForgejoBinary', () => {
  test('finds the web process the daemon runs, as ps prints it', () => {
    const ps = [
      'COMMAND',
      '/usr/sbin/cfprefsd agent',
      `${NIX} web --work-path /opt/homeflare/forgejo`,
      `${NIX} admin user list --work-path /opt/homeflare/forgejo`,
    ].join('\n');
    expect(runningForgejoBinary(ps)).toBe(NIX);
  });

  test('ignores a forgejo that is not serving, and one off PATH', () => {
    expect(runningForgejoBinary(`${NIX} admin user list`)).toBeUndefined();
    expect(runningForgejoBinary('/opt/homebrew/bin/forgejo web')).toBeUndefined();
    expect(runningForgejoBinary('')).toBeUndefined();
  });
});

describe('usernamesFrom', () => {
  test('reads the Username column of the measured table', () => {
    const table = [
      'ID   Username            Email                                   IsActive IsAdmin 2FA',
      '1    alice               alice@example.invalid                   true     true    false',
      '7    forgejo-provision   forgejo-provision@noreply.example        true     false   false',
      '',
    ].join('\n');
    expect(usernamesFrom(table)).toEqual(['alice', 'forgejo-provision']);
  });

  test('refuses a table it does not recognise rather than reporting nobody', () => {
    expect(() => usernamesFrom('something else entirely')).toThrow(/unexpected header/);
    expect(() => usernamesFrom('')).toThrow(/unexpected header/);
  });
});

describe('readCreateOutput', () => {
  const user = 'forgejo-provision';

  test('captures the password and keeps it out of the lines it echoes', () => {
    const stdout = [
      "generated random password is 'aB3dE5gH7jK9'",
      "New user 'forgejo-provision' has been successfully created!",
      '',
    ].join('\n');
    const out = readCreateOutput(stdout, user);
    expect(out.password).toBe('aB3dE5gH7jK9');
    expect(out.created).toBe(true);
    expect(out.rest.join('\n')).not.toContain('aB3dE5gH7jK9');
  });

  test('keeps a quote inside the password instead of truncating at it', () => {
    const out = readCreateOutput("generated random password is 'ab'c\"d e'", user);
    expect(out.password).toBe('ab\'c"d e');
  });

  test('reports not created when the success line names someone else or is missing', () => {
    expect(readCreateOutput("New user 'alice' has been successfully created!", user).created).toBe(
      false,
    );
    const noPassword = readCreateOutput(
      "New user 'forgejo-provision' has been successfully created!",
      user,
    );
    expect(noPassword.created).toBe(true);
    expect(noPassword.password).toBeUndefined();
  });
});
