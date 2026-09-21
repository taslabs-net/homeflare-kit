/**
 * Doc placeholders: the fixed token list, and their values for one site.
 */
import { describe, expect, test } from 'bun:test';
import { SITE_TOKENS, decodeSite, renderTokens, tokenValues } from '../src/index.ts';
import { example, withPath } from './fixture.ts';

const site = decodeSite(example());

describe('SITE_TOKENS', () => {
  test('is exactly the placeholder set public docs may use', () => {
    // ⛔ Adding a token is a doc-lint change in every public repo; do it deliberately.
    expect(Object.keys(SITE_TOKENS)).toEqual([
      '<apex>',
      '<vault-host>',
      '<vault-api-host>',
      '<mgmt-zone>',
      '<access-team>',
      '<github-owner>',
      '<estate-root>',
      '<cluster>',
    ]);
  });

  test('every single-valued token has a value; <cluster> has none', () => {
    const values = tokenValues(site);
    expect(values).toEqual({
      '<apex>': 'example.com',
      '<vault-host>': 'v.example.com',
      '<vault-api-host>': 'api.v.example.com',
      '<mgmt-zone>': 'mgmt.example.com',
      '<access-team>': 'example-team',
      '<github-owner>': 'example-org',
      '<estate-root>': '/opt/example',
    });
    expect(Object.keys(values)).not.toContain('<cluster>');
  });
});

describe('renderTokens', () => {
  test('substitutes every valued token, longest first', () => {
    expect(
      renderTokens('BAO_ADDR=https://<vault-api-host> (UI: <vault-host>, on <apex>)', site),
    ).toBe('BAO_ADDR=https://api.v.example.com (UI: v.example.com, on example.com)');
  });

  test('one pass: a value that contains a token is not substituted again', () => {
    const odd = decodeSite(withPath(example(), ['paths', 'estateRoot'], '/opt/<apex>'));
    expect(renderTokens('root=<estate-root> on <apex>', odd)).toBe(
      'root=/opt/<apex> on example.com',
    );
  });

  test('leaves <cluster> and unknown brackets alone', () => {
    expect(renderTokens('proxmox-<cluster> on <mgmt-zone>, see <other>', site)).toBe(
      'proxmox-<cluster> on mgmt.example.com, see <other>',
    );
  });
});
