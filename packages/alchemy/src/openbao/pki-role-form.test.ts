/**
 * Bao.PkiRole's six fields added 2026-09-21. The part worth pinning: a role written BEFORE they
 * were props carries OpenBao's defaults for them, and must still plan `noop`; a role that differs
 * on any of them must plan `update`, because the full-replace write would reset it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BaoPkiRoleProps,
  attributesOf,
  matches,
  problems,
  writeBody,
} from './pki-role-form.ts';

const PROPS: BaoPkiRoleProps = {
  allowedDomains: ['svc.example.com'],
  allowSubdomains: true,
  maxTtl: '8760h',
  name: 'host-cert',
  ttl: '720h',
};

/** What OpenBao 2.6.2 answers for a role this resource wrote before the six were props. */
const LIVE: Record<string, unknown> = {
  allow_bare_domains: false,
  allow_glob_domains: false,
  allow_ip_sans: false,
  allow_localhost: false,
  allow_subdomains: true,
  allow_wildcard_certificates: false,
  allowed_domains: ['svc.example.com'],
  allowed_domains_template: false,
  client_flag: true,
  cn_validations: ['hostname'],
  enforce_hostnames: true,
  ext_key_usage: [],
  generate_lease: false,
  key_bits: 0,
  key_type: 'rsa',
  key_usage: ['DigitalSignature', 'KeyAgreement', 'KeyEncipherment'],
  max_ttl: 31536000,
  no_store: false,
  require_cn: true,
  server_flag: true,
  signature_bits: 0,
  ttl: 2592000,
};

const same = (live: Record<string, unknown>, props: BaoPkiRoleProps = PROPS) =>
  matches(attributesOf(props, live), props);

describe('pki role — the six added fields', () => {
  it("still plans noop for a role that carries OpenBao's defaults", () => {
    assert.equal(same(LIVE), true);
  });

  it('plans update when live differs on any of them — the write would reset it', () => {
    const drifted: [string, unknown][] = [
      ['require_cn', false],
      ['enforce_hostnames', false],
      ['key_usage', ['DigitalSignature']],
      ['allowed_domains_template', true],
      ['no_store', true],
      ['generate_lease', true],
    ];
    for (const [field, value] of drifted) {
      assert.equal(same({ ...LIVE, [field]: value }), false, field);
    }
  });

  it('reads key_usage as a set, case-folded, like ext_key_usage', () => {
    const shuffled = {
      ...LIVE,
      key_usage: ['keyencipherment', 'DigitalSignature', 'KeyAgreement'],
    };
    assert.equal(same(shuffled), true);
  });

  it('matches declared values once live carries them', () => {
    const props = { ...PROPS, keyUsage: ['DigitalSignature'], noStore: true, requireCn: false };
    const live = { ...LIVE, key_usage: ['DigitalSignature'], no_store: true, require_cn: false };
    assert.equal(same(live, props), true);
    assert.equal(same(LIVE, props), false);
  });

  it("sends every one of them, with OpenBao's defaults when omitted", () => {
    const body = writeBody(PROPS);
    assert.equal(body['require_cn'], 'true');
    assert.equal(body['enforce_hostnames'], 'true');
    assert.equal(body['key_usage'], 'DigitalSignature,KeyAgreement,KeyEncipherment');
    assert.equal(body['allowed_domains_template'], 'false');
    assert.equal(body['no_store'], 'false');
    assert.equal(body['generate_lease'], 'false');
  });

  it('sends an empty keyUsage as an empty string, which the server reads as no usages', () => {
    assert.equal(writeBody({ ...PROPS, keyUsage: [] })['key_usage'], '');
  });
});

describe('pki role problems', () => {
  it('passes a sound declaration', () => {
    assert.deepEqual(problems(PROPS), []);
  });

  it('refuses noStore with generateLease, empty domains and bad durations', () => {
    assert.match(problems({ ...PROPS, generateLease: true, noStore: true }).join(), /noStore/);
    assert.match(problems({ ...PROPS, allowedDomains: [] }).join(), /allowedDomains is empty/);
    assert.match(problems({ ...PROPS, ttl: '4h30m' }).join(), /ttl=4h30m/);
  });
});
