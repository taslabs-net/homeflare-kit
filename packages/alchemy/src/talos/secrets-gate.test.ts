/**
 * Acceptance test 2 from docs/plans/2026-09-26-talos-secrets-flow.md: "no talos prop, attribute or
 * argv carries config bytes; state fixtures contain no PEM or token strings (grep gate in the
 * family's tests)." PR 307 shipped every other acceptance test from the design suite but not this
 * one (PR 307 red team, minor #4) — the builder's "every acceptance test covered" claim was wrong.
 *
 * ★ A POSITIVE CONTROL WOULD DEFEAT THE PURPOSE HERE. Unlike lxc-interior.test.ts's "prove PVE
 *   really has no such endpoint", this file's job is to prove NOTHING in this family's own source
 *   ever grew a byte-carrying field — there is no "real" case where a match should be found. The
 *   props/attributes shape checks are the load-bearing half: they fail loudly if a `config` or
 *   `configFile` field is ever added back next to `configKey`/`configDigest`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MachineConfigAttributes, MachineConfigProps } from './talos-machine-config.ts';

const TALOS_DIR = import.meta.dir;

/** Every `.ts` file this family owns — source, tests and fixtures alike. Never node_modules. */
const talosFiles = () =>
  readdirSync(TALOS_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(TALOS_DIR, name));

describe('secrets gate — acceptance test 2', () => {
  it('no file in this family embeds PEM material or a bootstrap-token shape', () => {
    const pem = /-----BEGIN [A-Z ]+-----/;
    // `talosctl gen secrets`' bootstrap token is a `<14>.<28>` lowercase-alnum id.secret pair
    // (REASONED from the published config schema) — never generated anywhere in this family.
    const bootstrapToken = /\b[a-z0-9]{14}\.[a-z0-9]{28}\b/;
    for (const file of talosFiles()) {
      const text = readFileSync(file, 'utf8');
      assert.equal(pem.test(text), false, `${file}: looks like it embeds a PEM block`);
      assert.equal(
        bootstrapToken.test(text),
        false,
        `${file}: looks like it embeds a bootstrap token`,
      );
    }
  });

  it('MachineConfigProps carries a key and a digest, never config bytes', () => {
    const sample: MachineConfigProps = {
      configDigest: 'x',
      configKey: 'nodes/10001',
      node: '198.51.100.10',
      target: { cluster: 'c1', mount: 'talos-c1' },
    };
    assert.deepEqual(Object.keys(sample).sort(), ['configDigest', 'configKey', 'node', 'target']);
  });

  it('MachineConfigAttributes carries a digest and a claim, never config bytes', () => {
    const sample: MachineConfigAttributes = {
      configDigest: 'x',
      converged: false,
      mode: 'auto',
      node: '198.51.100.10',
    };
    assert.deepEqual(Object.keys(sample).sort(), ['configDigest', 'converged', 'mode', 'node']);
  });
});
