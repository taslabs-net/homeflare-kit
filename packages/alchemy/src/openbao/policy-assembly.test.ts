/**
 * The refusal that stands between a bad checkout and a policy with every grant revoked.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isEmptyAssembly } from './policy-assembly.ts';

describe('isEmptyAssembly', () => {
  it('refuses a directory with no fragment files', () => {
    assert.equal(isEmptyAssembly(0, ''), true);
  });

  // ⛔ The case the first guard missed: files exist, grants do not.
  it('refuses fragments that are empty or whitespace', () => {
    assert.equal(isEmptyAssembly(1, '\n'), true);
    assert.equal(isEmptyAssembly(2, '   \n\t\n'), true);
  });

  it('refuses fragments that carry comments but no path grant', () => {
    assert.equal(isEmptyAssembly(1, '# homeflare-agent\n# grants follow\n'), true);
  });

  it('allows an assembly with at least one path grant, indented or not', () => {
    const kv = '# kv\npath "kv/data/apps/*" {\n  capabilities = ["read"]\n}\n';
    assert.equal(isEmptyAssembly(1, kv), false);
    assert.equal(isEmptyAssembly(1, '  path "sys/mounts" { capabilities = ["read"] }\n'), false);
  });
});
