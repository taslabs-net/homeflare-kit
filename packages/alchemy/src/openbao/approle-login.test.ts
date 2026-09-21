/**
 * appRoleLogin / revokeSelf against a fake, through the PROMISE wrappers a plain script calls — so
 * the fetch client, the env override and the error type are all exercised, not just the Effect.
 *
 * ⛔ Every call passes an explicit `env`; nothing here reads the shell's BAO_ADDR or BAO_TOKEN.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspect } from 'node:util';
import { BaoLoginError, appRoleLogin, revokeSelf } from './approle-login.ts';
import { withFake } from './fake-bao.ts';

const ROLE = 'role-id-fixture';
const SECRET = 'fixturefixture';
const AUTH = {
  auth: {
    accessor: 'accessor-fixture',
    client_token: 'token-fixture',
    lease_duration: 900,
    policies: ['default', 'host-cert'],
  },
};

const failure = async (pending: Promise<unknown>) => {
  const error = await pending.then(
    () => assert.fail('expected a rejection'),
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof BaoLoginError, 'rejects with BaoLoginError itself');
  return error;
};

describe('appRoleLogin', () => {
  it('logs in with no token header, whatever the environment holds', async () => {
    await withFake(
      () => ({ json: AUTH, status: 200 }),
      async (bao) => {
        const env = {
          BAO_ADDR: bao.address,
          BAO_NAMESPACE: 'homeflare',
          BAO_TOKEN: 'operator-token',
          VAULT_TOKEN: 'legacy-token',
        };
        const login = await appRoleLogin({ env, roleId: ROLE, secretId: SECRET });
        const [seen] = bao.seen;
        assert.equal(seen?.method, 'PUT');
        assert.equal(seen?.path, '/v1/auth/approle/login');
        assert.equal(seen?.body, JSON.stringify({ role_id: ROLE, secret_id: SECRET }));
        assert.equal(seen?.headers.get('x-vault-token'), null);
        assert.equal(seen?.headers.get('x-vault-namespace'), 'homeflare');
        assert.equal(login.clientToken, 'token-fixture');
        assert.equal(login.accessor, 'accessor-fixture');
        assert.deepEqual(login.policies, ['default', 'host-cert']);
        assert.equal(login.leaseDurationSeconds, 900);
      },
    );
  });

  /**
   * ⚠️ THE PRINTS ARE THE POINT. The first version passed JSON and Object.keys checks and still
   *   printed the token in full under bun's console.log (approle-login-result.ts has the measure).
   */
  it('keeps the token out of every print, JSON, spread and clone', async () => {
    await withFake(
      () => ({ json: AUTH, status: 200 }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        const login = await appRoleLogin({ env, roleId: ROLE, secretId: SECRET });
        const renderings = [
          Bun.inspect(login),
          inspect(login),
          inspect(login, { showHidden: true }),
          JSON.stringify(login),
          JSON.stringify({ ...login }),
          JSON.stringify(structuredClone(login)),
        ];
        for (const text of renderings) assert.ok(!text.includes('token-fixture'), text);
        assert.equal(Object.keys(login).includes('clientToken'), false);
        assert.equal(login.accessor, 'accessor-fixture');
      },
    );
  });

  it('logs in on a named mount', async () => {
    await withFake(
      () => ({ json: AUTH, status: 200 }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        await appRoleLogin({ env, mount: '/approle-hosts/', roleId: ROLE, secretId: SECRET });
        assert.equal(bao.seen[0]?.path, '/v1/auth/approle-hosts/login');
      },
    );
  });

  it('refuses empty, missing and padded inputs without sending anything', async () => {
    await withFake(
      () => ({ json: AUTH, status: 200 }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        const cases = [
          { roleId: '', secretId: SECRET },
          { roleId: ROLE, secretId: `${SECRET}\n` },
          { roleId: ROLE, secretId: undefined as unknown as string },
          { mount: '/', roleId: ROLE, secretId: SECRET },
          // ⛔ The URL parser would resolve these onto another path; nothing may be sent.
          { mount: '../../sys/tools', roleId: ROLE, secretId: SECRET },
          { mount: 'approle?x=', roleId: ROLE, secretId: SECRET },
        ];
        for (const input of cases) {
          const error = await failure(appRoleLogin({ env, ...input }));
          assert.equal(error.reason, 'input');
          assert.ok(!error.message.includes(SECRET));
        }
        assert.equal(bao.seen.length, 0);
      },
    );
  });

  it('redacts a secret_id OpenBao echoes back (approle path_login.go:291)', async () => {
    const echoed = { errors: [`invalid secret_id "${SECRET}"`] };
    await withFake(
      () => ({ json: echoed, status: 400 }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        const error = await failure(appRoleLogin({ env, roleId: ROLE, secretId: SECRET }));
        assert.equal(error.reason, 'refused');
        assert.equal(error.status, 400);
        assert.deepEqual(error.errors, ['invalid secret_id "[redacted]"']);
        assert.ok(!error.message.includes(SECRET));
      },
    );
  });

  it('describes a non-JSON error page by size, never by content', async () => {
    const page = `<html>502 upstream said ${SECRET}</html>`;
    await withFake(
      () => ({ status: 502, text: page }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        const error = await failure(appRoleLogin({ env, roleId: ROLE, secretId: SECRET }));
        assert.equal(error.status, 502);
        assert.match(error.message, /not an OpenBao error body/);
        assert.ok(!error.message.includes('upstream'));
      },
    );
  });

  it('names a 2xx without a usable login — not JSON, no auth block, unfinished MFA', async () => {
    const replies = [
      { json: { data: {} }, status: 200 },
      {
        json: { auth: { client_token: '', mfa_requirement: { mfa_request_id: 'x' } } },
        status: 200,
      },
      // ⚠️ Some other web server at BAO_ADDR: a yes that is not a login, never `refused 200`.
      { status: 200, text: '<html>welcome</html>' },
    ];
    const expected = [/no auth block/, /requires MFA/, /response 200: a success body/];
    for (const [index, reply] of replies.entries()) {
      await withFake(
        () => reply,
        async (bao) => {
          const env = { BAO_ADDR: bao.address };
          const error = await failure(appRoleLogin({ env, roleId: ROLE, secretId: SECRET }));
          assert.equal(error.reason, 'response');
          assert.match(error.message, expected[index] ?? /never/);
        },
      );
    }
  });
});

describe('revokeSelf', () => {
  it('revokes the token it was given, not the environment one', async () => {
    await withFake(
      () => ({ status: 204 }),
      async (bao) => {
        await revokeSelf('token-fixture', { BAO_ADDR: bao.address, BAO_TOKEN: 'operator-token' });
        const [seen] = bao.seen;
        assert.equal(seen?.method, 'PUT');
        assert.equal(seen?.path, '/v1/auth/token/revoke-self');
        assert.equal(seen?.headers.get('x-vault-token'), 'token-fixture');
      },
    );
  });

  it('refuses an empty token and redacts a refused one', async () => {
    await withFake(
      () => ({ json: { errors: ['permission denied for token-fixture'] }, status: 403 }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        assert.equal((await failure(revokeSelf('', env))).reason, 'input');
        assert.equal(bao.seen.length, 0);
        const refused = await failure(revokeSelf('token-fixture', env));
        assert.equal(refused.reason, 'refused');
        assert.ok(!refused.message.includes('token-fixture'));
      },
    );
  });
});
