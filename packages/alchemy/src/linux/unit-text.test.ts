/**
 * `unit-text.ts`'s own tests — the INI text-shape checks, on their own, separate from
 * `unit-lifecycle.test.ts`'s end-to-end fake-host behaviour.
 */
import { describe, expect, test } from 'bun:test';
import { hasInstallSection, textProblems } from './unit-text.ts';

// 🔴 REGRESSION, CT100 deploy 2026-09-26 00:11Z: `assertValid` refused this EXACT content — "a
//   unit file must begin with a [Section]" — even though it is byte-identical to what systemd
//   already loads on CT100 (sha256 verified against the live host). Leading lines copied
//   verbatim from homeflare-ct100's src/openbao-agent/files/openbao-agent.service.
const CT100_OPENBAO_AGENT = [
  "# CT100's openbao-agent.",
  '#',
  "# THIS FILE WAS RECOVERED FROM THE RUNNING BOX, NOT PUSHED TO IT. The repo's copy was STALE",
  '#   and would have REMOVED `Environment=BAO_NAMESPACE=homeflare` -- without which the agent',
  '#   authenticates into the root namespace, every template 403s, and the failure reads as a',
  '#   missing grant rather than a missing variable. That is the exact shape the vault policies',
  '#   README warns about: a deploy converging a stale copy over a working live one.',
  '# So the FIRST run of deploy-ct100.sh was a --dry-run, and this is what it was for.',
  '[Unit]',
  'Description=OpenBao agent',
  'After=network-online.target',
  'Wants=network-online.target',
  '[Service]',
  'Environment=BAO_NAMESPACE=homeflare',
  'ExecStart=/usr/bin/bao agent -config=/etc/openbao/agent.hcl',
  'RuntimeDirectory=openbao',
  'Restart=on-failure',
  'RestartSec=10',
  '[Install]',
  'WantedBy=multi-user.target',
  '',
].join('\n');

describe('textProblems', () => {
  test('the CT100 openbao-agent.service fixture validates — comments may precede [Unit]', () => {
    expect(textProblems(CT100_OPENBAO_AGENT)).toEqual([]);
  });

  test('blank lines alone may also precede the first section', () => {
    expect(textProblems('\n\n[Unit]\nDescription=x\n')).toEqual([]);
  });

  test('a ; comment is accepted the same as a #  comment', () => {
    expect(textProblems('; a semicolon comment\n[Unit]\nDescription=x\n')).toEqual([]);
  });

  test('a genuine key=value before any section still refuses — comments are not a blanket exemption', () => {
    expect(textProblems('Description=no section at all\n[Unit]\n').join(' ')).toMatch(
      /must begin with a \[Section\]/,
    );
  });

  test('an empty file and one with NUL are still refused', () => {
    expect(textProblems('   \n').join(' ')).toMatch(/is empty/);
    expect(textProblems('[Unit]\nDescription=a\u0000b\n').join(' ')).toMatch(/contains NUL/);
  });
});

describe('hasInstallSection', () => {
  test('true only once an [Install] key actually appears after the header', () => {
    expect(hasInstallSection('[Unit]\n[Install]\nWantedBy=multi-user.target\n')).toBe(true);
    expect(hasInstallSection('[Unit]\nDescription=x\n')).toBe(false);
    expect(hasInstallSection('[Unit]\n[Install]\n')).toBe(false);
  });
});
