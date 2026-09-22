/**
 * Bao.SshRole's two shapes — a user-cert role and a host-cert role — through writeBody and back
 * through attributesOf, the round trip every plan rests on.
 *
 * ★ `cert_type` IS NOT A ROLE FIELD. It is a SIGN parameter, default `user` (openbao v2.6.2
 *   builtin/logical/ssh/path_sign.go:50-54); a host-cert role is `allow_host_certificates` plus the
 *   domain fields, and the host asks for `cert_type=host` when it signs. path_roles.go has no such
 *   field, so nothing here sends one.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BaoSshRoleProps,
  attributesOf,
  matches,
  resolve,
  writeBody,
} from './ssh-role-form.ts';

const USER: BaoSshRoleProps = {
  allowUserCertificates: true,
  allowedUsers: ['ops', 'deploy'],
  defaultExtensions: { 'permit-pty': '', 'permit-agent-forwarding': '' },
  maxTtl: '16h',
  name: 'operator',
  ttl: '16h',
};

const HOST: BaoSshRoleProps = {
  allowHostCertificates: true,
  allowSubdomains: true,
  allowedDomains: ['example.test', 'lab.example.test'],
  allowedUsers: [],
  maxTtl: '8760h',
  mount: 'ssh-host/',
  name: 'host',
  ttl: '8760h',
};

describe('ssh role writeBody', () => {
  it('sends the maps as JSON objects, never as JSON strings (sdk TypeMap refuses a string)', () => {
    const body = writeBody(resolve(USER));
    assert.deepEqual(body['default_extensions'], {
      'permit-agent-forwarding': '',
      'permit-pty': '',
    });
    assert.deepEqual(body['default_critical_options'], {});
    assert.equal(typeof body['default_extensions'], 'object');
  });

  it('writes a user-cert role with key_type ca, sorted principals and a stated TTL', () => {
    const body = writeBody(resolve(USER));
    assert.equal(body['key_type'], 'ca');
    assert.equal(body['allowed_users'], 'deploy,ops');
    assert.equal(body['allow_user_certificates'], 'true');
    assert.equal(body['allow_host_certificates'], 'false');
    assert.equal(body['ttl'], '16h');
    assert.equal('cert_type' in body, false);
  });

  it('writes a host-cert role with domains and subdomains on its own mount', () => {
    const form = resolve(HOST);
    const body = writeBody(form);
    assert.equal(form.mount, 'ssh-host');
    assert.equal(body['allow_host_certificates'], 'true');
    assert.equal(body['allow_user_certificates'], 'false');
    assert.equal(body['allowed_domains'], 'example.test,lab.example.test');
    assert.equal(body['allow_subdomains'], 'true');
    assert.equal(body['allowed_users'], '');
  });
});

describe('ssh role round trip', () => {
  it('matches the role OpenBao reads back — seconds, objects, comma strings', () => {
    const live = {
      allow_host_certificates: false,
      allow_user_certificates: true,
      allowed_users: 'ops,deploy',
      default_critical_options: {},
      default_extensions: { 'permit-agent-forwarding': '', 'permit-pty': '' },
      key_type: 'ca',
      max_ttl: 57600,
      ttl: 57600,
    };
    const form = resolve(USER);
    assert.equal(matches(attributesOf(form, live), form), true);
    assert.equal(matches(attributesOf(form, { ...live, ttl: 14400 }), form), false);
  });

  it('matches a host role read back', () => {
    const live = {
      allow_host_certificates: true,
      allow_subdomains: true,
      allowed_domains: 'lab.example.test,example.test',
      allowed_users: '',
      default_critical_options: {},
      default_extensions: {},
      key_type: 'ca',
      max_ttl: 31536000,
      ttl: 31536000,
    };
    const form = resolve(HOST);
    assert.equal(matches(attributesOf(form, live), form), true);
  });
});
