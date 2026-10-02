import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeSql } from './fake-sql.ts';
import { diffPostgresRole } from './role-diff.ts';
import { reconcileWithClient } from './role.ts';
import { seal } from '../secrets/write-only.ts';
import type { PostgresRoleAttributes } from './role-attrs.ts';

const props = {
  name: 'ascii-seat',
  login: true,
  inherit: true,
  connectionLimit: -1,
  password: { fromEnv: 'TEST_PASSWORD' },
};
const live: PostgresRoleAttributes = {
  ...props,
  oid: 42,
  validUntil: null,
  memberOf: [],
  passwordSeal: '',
};

// Synthetic values cover SASLprep mapping, normalization and invalid Unicode; never credentials.
test.each(['soft\u00adhyphen', 'caf\u00e9', '\u2168', '\ud800'])(
  'non-ASCII case %# refuses create, adopt, sealed reconcile and diff without exposing input',
  async (password) => {
    const env = { TEST_PASSWORD: password };
    const passwordSeal = seal({ password }, 'test-salt');
    for (const exists of [false, true]) {
      const fake = makeFakeSql({ roleRows: exists ? [live] : [] });
      for (const previous of ['', passwordSeal]) {
        const error = await Effect.runPromise(
          reconcileWithClient(fake, props, env, previous).pipe(
            Effect.catchTag('PostgresRolePasswordNonAsciiRefused', Effect.succeed),
          ),
        );
        expect(error).toMatchObject({
          _tag: 'PostgresRolePasswordNonAsciiRefused',
          role: props.name,
        });
        expect(JSON.stringify(error)).not.toContain(password);
        expect(fake.statements).toEqual([]);
      }
    }
    const error = await Effect.runPromise(
      diffPostgresRole(props, { ...live, passwordSeal }, env).pipe(
        Effect.catchTag('PostgresRolePasswordNonAsciiRefused', Effect.succeed),
      ),
    );
    expect(error).toHaveProperty('_tag', 'PostgresRolePasswordNonAsciiRefused');
  },
);
