/**
 * The tripwire trips on the names and shapes people type — and stays quiet on the file-path
 * pattern it tells them to use instead. A tripwire that fired on `*_FILE` would train people to
 * route around it.
 */
import { describe, expect, test } from 'bun:test';
import { fileSecretProblems, jobSecretProblems } from './secret-tripwire.ts';

/**
 * ⚠️ ASSEMBLED FROM PARTS ON PURPOSE. Written out whole, this fixture trips gitleaks' `private-key`
 *   rule in the pre-commit hook — measured 2026-09-21 — even though the body is four letters.
 */
const KEY = `${'PRIVATE'} KEY-----`;
const PEM = [`-----BEGIN OPENSSH ${KEY}`, 'AAAA', `-----END OPENSSH ${KEY}`].join('\n');

describe('environment names', () => {
  test.each([
    'API_TOKEN',
    'VAULT_TOKEN',
    'TOKEN',
    'CLIENT_SECRET',
    'DB_PASSWORD',
    'SMTP_PASSWD',
    'OPENAI_API_KEY',
    'APIKEY',
    'AWS_SECRET_ACCESS_KEY',
    'SIGNING_PRIVATE_KEY',
    'GOOGLE_CREDENTIALS',
    'api_token',
  ])('%s trips', (name) => {
    expect(jobSecretProblems({ [name]: 'value' }, ['/bin/x'])).toHaveLength(1);
  });

  test.each([
    'API_TOKEN_FILE',
    'DB_PASSWORD_PATH',
    'SSL_CERT_FILE',
    'TOKENIZER',
    'HOME',
    'PATH',
    'SECRET_DIR',
    'AWS_ACCESS_KEY_ID',
    'KEYCHAIN',
  ])('%s does not', (name) => {
    expect(jobSecretProblems({ [name]: '/some/path' }, ['/bin/x'])).toEqual([]);
  });

  test('a private key in any variable trips', () => {
    expect(jobSecretProblems({ INNOCENT: PEM }, ['/bin/x'])).toHaveLength(1);
  });
});

describe('arguments', () => {
  test.each([
    [['/bin/x', '--token=abc']],
    [['/bin/x', '--vault-token=abc']],
    [['/bin/x', '-password=abc']],
    [['/bin/x', '--api-key=abc']],
    [['/bin/x', '--token', 'abc']],
    [['/bin/x', '--client-secret', 'abc']],
    [['/bin/x', PEM]],
  ])('%j trips', (argv) => {
    expect(jobSecretProblems(undefined, argv)).toHaveLength(1);
  });

  test.each([
    [['/bin/x', '--token-file=/run/secret']],
    [['/bin/x', '--token-file', '/run/secret']],
    [['/bin/x', '--password-file', '/run/secret']],
    [['/bin/x', '--token']],
    [['/bin/x', '--config', '/etc/x.yml']],
  ])('%j does not', (argv) => {
    expect(jobSecretProblems(undefined, argv)).toEqual([]);
  });

  test('a refusal never echoes the secret it found', () => {
    const [problem] = jobSecretProblems(undefined, [
      '/bin/x',
      '--token=hunter2',
      '--secret',
      'hunter3',
    ]);
    expect(problem).not.toContain('hunter');
    expect(jobSecretProblems({ API_TOKEN: 'hunter4' }, ['/bin/x']).join()).not.toContain('hunter4');
  });

  test('a private key anywhere in extraKeys trips, by path, without echoing it', () => {
    const found = jobSecretProblems(undefined, ['/bin/x'], {
      Sockets: { Listener: [{ SockServiceName: '9000' }, { Blob: `x\n${PEM}` }] },
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('extraKeys.Sockets.Listener[1].Blob');
    expect(found[0]).not.toContain('BEGIN');
  });

  test('every refusal names the alternative', () => {
    expect(jobSecretProblems({ API_TOKEN: 'x' }, ['/bin/x']).join()).toContain('openbao-agent');
  });
});

describe('file content', () => {
  test('a PEM private key trips; a certificate or public key does not', () => {
    expect(fileSecretProblems(`config\n${PEM}\n`)).toHaveLength(1);
    expect(fileSecretProblems(`-----BEGIN RSA ${KEY}\n`)).toHaveLength(1);
    expect(
      fileSecretProblems('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'),
    ).toEqual([]);
    expect(fileSecretProblems('ssh-ed25519 AAAAC3Nza example\n')).toEqual([]);
  });
});
