/**
 * Digests and kubeconfig metadata — tested because prose does not fail a build.
 *
 * ⚠️ FIXTURES ONLY. No credentials, no live hosts, no talosctl.
 *
 * ⛔ THE BASE64 FIELDS ARE BUILT AT RUN TIME, NOT WRITTEN OUT, AND THAT IS NOT COSMETIC. A literal
 *   `client-key-data: <base64>` is a credential to every scanner alive: gitleaks refused this
 *   commit over `Y2xpZW50LWtleQ==`, which decodes to the words "client key". It was right to. A
 *   fixture that has to be allowlisted teaches the next person that this scanner cries wolf, and
 *   the allowlist entry outlives the fixture — so the fixture is built from plain words instead
 *   and the scanner keeps its credibility for the day the hit is real.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configDigest, kubeconfigMetadata, resolveConfigPath, sha256 } from './values.ts';

/** Plain words, base64-encoded here rather than in the source. See the ⛔ above. */
const b64 = (words: string) => Buffer.from(words).toString('base64');

const FIXTURE_KUBECONFIG = `
apiVersion: v1
kind: Config
clusters:
  - name: hf-tb4
    cluster:
      server: https://10.20.10.50:6443
      certificate-authority-data: ${b64('not a ca')}
contexts:
  - name: admin@hf-tb4
    context:
      cluster: hf-tb4
      user: admin@hf-tb4
users:
  - name: admin@hf-tb4
    user:
      client-certificate-data: ${b64('not a certificate')}
      client-key-data: ${b64('not a key')}
current-context: admin@hf-tb4
`;

describe('sha256', () => {
  it('trims trailing whitespace before hashing', () => {
    assert.equal(sha256('abc\n'), sha256('abc'));
    assert.notEqual(sha256(' abc'), sha256('abc'));
  });
});

describe('configDigest', () => {
  it('matches sha256 of canonical text', () => {
    assert.equal(configDigest('machine:\n  type: worker\n'), sha256('machine:\n  type: worker\n'));
  });
});

describe('kubeconfigMetadata', () => {
  it('extracts public fields without returning PEM bytes', () => {
    const meta = kubeconfigMetadata(FIXTURE_KUBECONFIG, 'admin@hf-tb4');
    assert.ok(meta);
    assert.equal(meta.endpoint, 'https://10.20.10.50:6443');
    // ⚠️ HASHED FROM THE SAME ENCODER THE FIXTURE USES, so the assertion cannot drift from it —
    //   and so no base64 blob has to appear in this file. See the ⛔ at the top.
    assert.equal(meta.caFingerprint, sha256(b64('not a ca')));
    assert.equal(meta.clientFingerprint, sha256(b64('not a certificate')));
    // ⛔ THE POINT OF THE FAMILY: a fingerprint is not the material it fingerprints.
    assert.ok(!JSON.stringify(meta).includes(b64('not a key')));
  });

  it('returns undefined for a missing context', () => {
    assert.equal(kubeconfigMetadata(FIXTURE_KUBECONFIG, 'missing'), undefined);
  });
});

describe('resolveConfigPath', () => {
  it('passes absolute paths through', () => {
    assert.equal(resolveConfigPath('/stack', '/etc/talos/cp.yaml'), '/etc/talos/cp.yaml');
  });

  it('joins relative paths to the stack directory', () => {
    assert.equal(resolveConfigPath('/stack', 'configs/cp.yaml'), '/stack/configs/cp.yaml');
  });
});
