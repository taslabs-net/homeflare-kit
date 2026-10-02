import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { makeFakeSql } from './fake-sql.ts';
import { buildRepairMembershipSql, syncMemberships } from './role-membership-sql.ts';
import { makePsqlExecutor } from './psql-executor.ts';

const props = {
  name: 'seat',
  login: false,
  inherit: true,
  connectionLimit: -1,
  memberOf: ['parent'],
};
const rows = [{ parent: 'parent', grantor: 'postgres', admin: true, set: true }];

test('a failed option revoke rolls back earlier membership changes', async () => {
  const fake = makeFakeSql({ roles: ['parent'], failNext: 'REVOKE SET OPTION' });
  const key = 'seat\0parent\0postgres';
  fake.memberships.add(key);
  fake.membershipOptions.set(key, { admin: true, set: true });
  const error = await Effect.runPromise(
    syncMemberships(fake, props, rows).pipe(Effect.catchTag('SqlError', Effect.succeed)),
  );
  expect(error).toHaveProperty('_tag', 'SqlError');
  expect(fake.memberships.has(key)).toBe(true);
  expect(fake.membershipOptions.get(key)).toEqual({ admin: true, set: true });
});

test('dependent-grant refusal remains catchTag SqlError over the psql runner', async () => {
  // Measured on PG 17.11, 2026-10-02: RESTRICT refuses while member has granted parent
  // onward; both membership rows remain. The real server is the dependency authority.
  const scripts: string[] = [];
  const pg = makePsqlExecutor(
    ({ stdin }) => {
      scripts.push(stdin);
      return Promise.resolve(
        stdin.startsWith('BEGIN')
          ? {
              code: 3,
              stdout: '',
              stderr:
                'ERROR:  2BP01: dependent privileges exist\nHINT:  Use CASCADE to revoke them too.',
            }
          : { code: 0, stdout: '[{"present":1}]', stderr: '' },
      );
    },
    { username: 'postgres', database: 'postgres' },
  );
  const error = await Effect.runPromise(
    syncMemberships(pg, props, rows).pipe(Effect.catchTag('SqlError', Effect.succeed)),
  );
  expect(error).toHaveProperty('_tag', 'SqlError');
  expect(scripts.at(-1)).toBe(
    'BEGIN;\nREVOKE ADMIN OPTION FOR "parent" FROM "seat" GRANTED BY "postgres" RESTRICT;\nREVOKE SET OPTION FOR "parent" FROM "seat" GRANTED BY "postgres" RESTRICT;\nCOMMIT;',
  );
});

test('option revocation quotes all three identities', () => {
  expect(buildRepairMembershipSql('m"', 'p"', 'g"', 'ADMIN')).toBe(
    'REVOKE ADMIN OPTION FOR "p""" FROM "m""" GRANTED BY "g""" RESTRICT',
  );
});
