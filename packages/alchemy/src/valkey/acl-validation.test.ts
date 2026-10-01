/** Validate declarations before any write; a seat name becomes part of a glob. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { ValkeyError } from './errors.ts';
import type { ValkeyAclUser } from './acl-attrs.ts';
import { reconcileWithExecutor } from './acl-reconcile.ts';
import { makeValkeyAclFileHandlers } from './acl.ts';
import { makeFakeValkey } from './fake-valkey.ts';
import { connection, context, required, run } from './handler-test-fixture.ts';

const seat: ValkeyAclUser = {
  name: 'seat',
  profile: 'seat',
  password: { fromEnv: 'TEST_VALKEY_USER_PW' },
};
const invalid: ReadonlyArray<readonly [ValkeyAclUser, ValkeyError['_tag']]> = [
  ...['*', '?', '[ab]', '\\'].map(
    (glob) => [{ ...seat, name: `seat${glob}` }, 'ValkeyAclNameGlob'] as const,
  ),
  [{ ...seat, channelPatterns: ['*'] }, 'ValkeyAclChannelPatterns'],
  [{ ...seat, profile: 'monitor', keyPrefix: '*' }, 'ValkeyAclMonitorKeyPrefix'],
  [{ ...seat, profile: 'monitor', channelPatterns: ['*'] }, 'ValkeyAclChannelPatterns'],
];

for (const [user, tag] of invalid) {
  test(`refuse ${user.name} ${user.profile} with ${tag} in diff and reconcile`, async () => {
    const fake = makeFakeValkey();
    const props = { instance: 'scratch', users: { [user.name]: user } };
    const error = await Effect.runPromise(
      Effect.flip(
        reconcileWithExecutor(fake, props, undefined, { TEST_VALKEY_USER_PW: 'FAKE-password' }),
      ),
    );
    expect(error._tag).toBe(tag);
    expect(fake.commands.some(({ args }) => args[1] === 'SETUSER')).toBe(false);
    const handlers = makeValkeyAclFileHandlers(connection(fake));
    const failure = await run(
      Effect.flip(
        required(handlers.diff)({ ...context, olds: props, news: props, output: undefined }),
      ),
    );
    expect(failure._tag).toBe(tag);
  });
}

test('aclfile probe failure is not treated as an empty file path', async () => {
  const fake = makeFakeValkey();
  fake.config.delete('aclfile');
  const failure = await Effect.runPromise(
    Effect.flip(reconcileWithExecutor(fake, { instance: 'scratch', users: {} }, undefined, {})),
  );
  expect(failure._tag).toBe('ValkeyServerError');
  expect(fake.commands.some(({ args }) => args[1] === 'SETUSER')).toBe(false);
});
