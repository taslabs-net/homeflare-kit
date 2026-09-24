/**
 * `describeKeyRef` — proves it formats a plain reference and refuses anything key-shaped, so the
 * one place this family turns a `GoogleWorkspaceKeyRef` into text (docs, the census handoff
 * header) cannot be handed a real credential by mistake.
 */
import { describe, expect, test } from 'bun:test';
import { type GoogleWorkspaceKeyRef, describeKeyRef } from './credentials.ts';

const REF: GoogleWorkspaceKeyRef = {
  delegatedAdmin: 'admin@schenanigans.com',
  openBaoPath: 'kv/google-workspace/service-accounts/directory-admin',
  scopes: ['https://www.googleapis.com/auth/admin.directory.group.readonly'],
};

describe('describeKeyRef', () => {
  test('formats a plain reference — path, delegated admin, scopes', () => {
    const line = describeKeyRef(REF);
    expect(line).toContain('kv/google-workspace/service-accounts/directory-admin');
    expect(line).toContain('admin@schenanigans.com');
    expect(line).toContain('admin.directory.group.readonly');
  });

  test('refuses an openBaoPath that looks like a PEM private key', () => {
    expect(() =>
      describeKeyRef({ ...REF, openBaoPath: '-----BEGIN PRIVATE KEY-----\nMIIE...' }),
    ).toThrow(/looks like key material/);
  });

  test('refuses a scopes entry that looks like a service-account JSON blob', () => {
    expect(() =>
      describeKeyRef({ ...REF, scopes: ['{"type": "service_account", "private_key": "x"}'] }),
    ).toThrow(/looks like key material/);
  });

  test('refuses a delegatedAdmin field carrying a private_key fragment', () => {
    expect(() => describeKeyRef({ ...REF, delegatedAdmin: 'private_key leaked here' })).toThrow(
      /looks like key material/,
    );
  });
});
