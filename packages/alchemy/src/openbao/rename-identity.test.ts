/**
 * What each family counts as "the same object": the case the server folds, the mount an absent prop
 * means, a trailing `/`, and a plugin's version. rename-identity.ts spells an identity twice, as the
 * diff's props DECLARE it and as a generation's attributes RECORD it, and the two must agree, or a
 * plan reads a resource's own object as a move onto somebody else's. Run through Alchemy's own plan
 * and apply (fake-stack.ts) against fake-engines-roles.ts.
 *
 * ⛔ TEST-ONLY. Every value is a placeholder, not the estate's.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import { rowOf, withEstate } from './fake-families.ts';
import { writesOf } from './fake-stack.ts';
import { BaoJwtAuthConfig } from './jwt-config.ts';
import { BaoPkiRole } from './pki-role.ts';
import { BaoPlugin } from './plugin.ts';
import { foldName } from './rename-identity.ts';

const OCCUPIED = /would land on an object that already exists/;

describe('a change of case the server folds away is not a rename', () => {
  it('foldName lowercases the name segment only; a mount path keeps its case', () => {
    assert.equal(foldName('Host-Cert'), 'host-cert');
    assert.equal(foldName('auth/K8s/role/App'), 'auth/K8s/role/app');
  });

  it('Bao.AuthRole: `Host-A` after `host-a` under destroy is a noop, nothing deleted', async () => {
    const row = rowOf('Bao.AuthRole');
    await withEstate(async (stack, estate, seen) => {
      await stack.deploy(row.declare('Role', 'host-a', '15m', RemovalPolicy.destroy));
      seen.length = 0;
      const plan = await stack.deploy(row.declare('Role', 'Host-A', '15m', RemovalPolicy.destroy));
      assert.deepEqual(plan, { Role: 'noop' });
      assert.deepEqual(writesOf(seen), []);
      assert.ok(row.has(estate, 'host-a'));
    });
  });

  /**
   * ★ Both refuse an upper-case name (`problems`), so the change is refused either way. Folded, it is
   *   refused for what it is; compared exactly, the plan read `role/App`, the server folded that to
   *   the role's own `role/app`, and the move was refused as landing on an object that exists.
   */
  for (const family of ['Bao.JwtRole', 'Bao.KubernetesRole']) {
    it(`${family}: \`App\` after \`app\` is the same role, refused only for its case`, async () => {
      const row = rowOf(family);
      await withEstate(async (stack, estate, seen) => {
        await stack.deploy(row.declare('Role', 'app', '15m', RemovalPolicy.destroy));
        seen.length = 0;
        const again = stack.deploy(row.declare('Role', 'App', '15m', RemovalPolicy.destroy));
        await assert.rejects(again, /must be lower case/);
        assert.deepEqual(writesOf(seen), []);
        assert.ok(row.has(estate, 'app'));
      });
    });
  }
});

describe('the mount an absent prop means, and a trailing `/`, are the same mount', () => {
  it('Bao.JwtAuthConfig with no `mount` redeploys as a noop: the default is `jwt`', async () => {
    const config = () =>
      BaoJwtAuthConfig('Config', {
        boundIssuer: 'https://issuer.example.com',
        jwksUrl: 'https://issuer.example.com/keys',
      });
    await withEstate(async (stack, estate, seen) => {
      await stack.deploy(config());
      seen.length = 0;
      assert.deepEqual(await stack.deploy(config()), { Config: 'noop' });
      assert.deepEqual(writesOf(seen), []);
      assert.ok(estate.roles.live.has('auth/jwt/config'));
    });
  });

  it('Bao.PkiRole: `pki/` after the default mount is the same role, a noop', async () => {
    const role = (mount?: string) =>
      BaoPkiRole('Role', {
        allowedDomains: ['example.com'],
        maxTtl: '8760h',
        name: 'web',
        ttl: '15m',
        ...(mount === undefined ? {} : { mount }),
      }).pipe(RemovalPolicy.destroy());
    await withEstate(async (stack, estate, seen) => {
      await stack.deploy(role());
      seen.length = 0;
      assert.deepEqual(await stack.deploy(role('pki/')), { Role: 'noop' });
      assert.deepEqual(writesOf(seen), []);
      assert.ok(estate.roles.live.has('pki/roles/web'));
    });
  });
});

describe('Bao.Plugin: the version is part of the catalog key', () => {
  const CATALOG = 'sys/plugins/catalog/secret/example';
  const plugin = (version: string) =>
    BaoPlugin('Plugin', {
      command: 'plugin-example',
      name: 'example',
      sha256: 'a'.repeat(64),
      type: 'secret',
      version,
    }).pipe(RemovalPolicy.destroy());

  it('a bump registers the new version, then deregisters the old one', async () => {
    await withEstate(async (stack, estate, seen) => {
      await stack.deploy(plugin('v1.0.0'));
      seen.length = 0;
      assert.deepEqual(await stack.deploy(plugin('v1.1.0')), { Plugin: 'replace' });
      assert.deepEqual(writesOf(seen), [
        `PUT /v1/${CATALOG}`,
        `DELETE /v1/${CATALOG}?version=v1.0.0`,
      ]);
      assert.deepEqual([...estate.plugins.live.keys()], [`${CATALOG}?version=v1.1.0`]);
    });
  });

  it('a bump onto a version already registered by hand fails the plan', async () => {
    await withEstate(async (stack, estate, seen) => {
      await stack.deploy(plugin('v1.0.0'));
      const byHand = { builtin: false, command: 'plugin-example', version: 'v1.1.0' };
      estate.plugins.live.set(`${CATALOG}?version=v1.1.0`, byHand);
      seen.length = 0;
      await assert.rejects(stack.deploy(plugin('v1.1.0')), OCCUPIED);
      assert.deepEqual(writesOf(seen), []);
    });
  });
});
