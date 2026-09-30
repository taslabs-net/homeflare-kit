/**
 * `Valkey.AclFile` against `fake-valkey.ts`'s recording fake — creating a user, converging a user
 * tampered with outside the stack, rotating a password, removing a user, missing-password
 * refusal, and read-back verification. Every case reverts cleanly by reverting `acl-ops.ts`/
 * `acl-form.ts` locally.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { readWithExecutor, reconcileWithExecutor } from './acl-ops.ts';
import { buildSetUserArgs, matchesDeclared, parseAclLine, planAclUsers } from './acl-form.ts';
import { ValkeyAclPasswordMissing, ValkeyAclReadbackFailed } from './errors.ts';
import { makeFakeValkey } from './fake-valkey.ts';
import type { ValkeyAclFileProps, ValkeyAclUser } from './acl-attrs.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const env = { CLAUDE_PW: 'hunter2', GROK_PW: 'grokpw' };
const claude: ValkeyAclUser = {
  name: 'claude',
  keyPrefix: 'claude:*',
  profile: 'seat',
  password: { fromEnv: 'CLAUDE_PW' },
};
const props = (over: Partial<ValkeyAclFileProps['users']> = {}): ValkeyAclFileProps => ({
  instance: 'valkey-seats',
  users: { claude, ...over },
});

describe('buildSetUserArgs', () => {
  test('emits reset-first, on, password, key prefix, channel scope, and the seat deny list', () => {
    const args = buildSetUserArgs(claude, 'pw');
    expect(args.slice(0, 4)).toEqual(['ACL', 'SETUSER', 'claude', 'reset']);
    expect(args).toContain('on');
    expect(args).toContain('>pw');
    expect(args).toContain('~claude:*');
    expect(args).toContain('&claude:*');
    expect(args).toContain('-flushall');
    expect(args).toContain('-acl');
    expect(args).toContain('-scan');
    // reset first: no stale rules survive a rebuild.
    expect(args.indexOf('reset')).toBeLessThan(args.indexOf('>pw'));
  });
});

describe('parseAclLine', () => {
  test('parses the measured ACL LIST echo shape', () => {
    expect(parseAclLine('user claude on #hash ~claude:* &claude:* +@read +@write -scan')).toEqual({
      name: 'claude',
      on: true,
      nopass: false,
      hasPassword: true,
      keyPatterns: ['~claude:*'],
      channelPatterns: ['&claude:*'],
      rules: ['+@read', '+@write', '-scan'],
    });
  });
});

describe('matchesDeclared', () => {
  test('rejects a user widened with an extra key pattern', () => {
    const parsed = parseAclLine('user claude on #h ~claude:* ~* &claude:* +@read +@write -scan');
    expect(matchesDeclared(parsed, claude)).toBe(false);
  });
});

describe('planAclUsers', () => {
  test('splits into create, update, remove — update catches external tampering, not only a prefix change', () => {
    const declared = {
      claude,
      grok: {
        name: 'grok',
        keyPrefix: 'grok:*',
        profile: 'seat',
        password: { fromEnv: 'Y' },
      } satisfies ValkeyAclUser,
    };
    const live = {
      claude: parseAclLine('user claude on #h ~claude:OLD:* &claude:* +@read -scan'), // prefix drift
      grok: parseAclLine('user grok on #h ~grok:* &grok:* +@all -scan'), // widened rules, same prefix
      stale: parseAclLine('user stale on #h ~stale:* &stale:* +@read -scan'),
    };
    const plan = planAclUsers(declared, live);
    expect(plan.create.map((u) => u.name)).toEqual([]);
    expect(plan.update.map((u) => u.name).sort()).toEqual(['claude', 'grok']);
    expect(plan.remove).toEqual(['stale']);
  });

  test('a disabled user is an update, not a silent no-op', () => {
    const live = {
      claude: parseAclLine('user claude off #h ~claude:* &claude:* +@read -scan'),
    };
    expect(planAclUsers({ claude }, live).update.map((u) => u.name)).toEqual(['claude']);
  });
});

describe('reconcile', () => {
  test('creates a declared user and read-back confirms it with a fresh seal', async () => {
    const fake = makeFakeValkey({ passwords: {} });
    const attrs = await run(reconcileWithExecutor(fake, props(), undefined, env));
    expect(attrs.users.claude?.keyPrefix).toBe('claude:*');
    expect(attrs.users.claude?.on).toBe(true);
    expect(attrs.users.claude?.hasPassword).toBe(true);
    expect(attrs.users.claude?.passwordSeal).toStartWith('scrypt:');
    expect(fake.commands.some((c) => c.args[0] === 'ACL' && c.args[1] === 'SETUSER')).toBe(true);
  });

  test('converges a user tampered with outside the stack instead of failing read-back forever', async () => {
    // Same prefix and password, but widened rules (`+@all` over the seat profile) and an extra
    // key pattern — exactly the tampering this family exists to undo.
    const fake = makeFakeValkey({
      acl: { claude: 'user claude on #h ~claude:* ~* &claude:* +@all -scan' },
    });
    const attrs = await run(reconcileWithExecutor(fake, props(), undefined, env));
    expect(attrs.users.claude?.profile).toBe('seat');
    expect(attrs.users.claude?.extraKeyPatterns).toEqual([]);
    expect(attrs.users.claude?.channelPatterns).toEqual(['&claude:*']);
  });

  test('rotates a password when the stored seal disagrees with the resolved value', async () => {
    const fake = makeFakeValkey({ passwords: {} });
    // The first reconcile creates claude from hunter2 and mints the seal.
    const first = await run(reconcileWithExecutor(fake, props(), undefined, env));
    const seal = first.users.claude?.passwordSeal;
    expect(seal).toStartWith('scrypt:');
    const setUsers = (): number =>
      fake.commands.filter((c) => c.args[0] === 'ACL' && c.args[1] === 'SETUSER').length;
    const writes = setUsers();
    // Same value again: the seal matches, so nothing is rewritten and the seal is kept.
    const again = await run(reconcileWithExecutor(fake, props(), first, env));
    expect(again.users.claude?.passwordSeal).toBe(seal);
    expect(setUsers()).toBe(writes);
    // A changed variable makes the stored seal stale: exactly one rewrite, a fresh seal.
    const rotated = await run(
      reconcileWithExecutor(fake, props(), first, { ...env, CLAUDE_PW: 'newpw' }),
    );
    expect(rotated.users.claude?.passwordSeal).not.toBe(seal);
    expect(rotated.users.claude?.passwordSeal).toStartWith('scrypt:');
    expect(setUsers()).toBe(writes + 1);
  });

  test('never manages the connection username (the admin) — not read, planned or removed', async () => {
    // The consuming stack connects as the instance's admin (docs/valkey.md): if the family
    // planned or removed that user it would delete its own credential and lock itself out.
    const fake = makeFakeValkey({
      acl: { admin: 'user admin on >h ~* +@all' },
    });
    const attrs = await run(reconcileWithExecutor(fake, props(), undefined, env, 'admin'));
    expect(attrs.users.admin).toBeUndefined();
    expect(attrs.users.claude?.keyPrefix).toBe('claude:*');
    // The admin line survives in the fake, and no DELUSER ever names it.
    expect(fake.acl.get('admin')).toContain('user admin on');
    const dels = fake.commands.filter((c) => c.args[0] === 'ACL' && c.args[1] === 'DELUSER');
    expect(dels.every((c) => !c.args.slice(2).includes('admin'))).toBe(true);
  });

  test('refuses with a typed error when a password variable is missing', async () => {
    const fake = makeFakeValkey({});
    // An explicit empty environment: the refusal must not depend on what this process happens
    // to hold, and nothing may have been written by the time it fails.
    const error = await fails(reconcileWithExecutor(fake, props(), undefined, {}));
    expect(error).toBeInstanceOf(ValkeyAclPasswordMissing);
    expect((error as ValkeyAclPasswordMissing).variable).toBe('CLAUDE_PW');
    expect(fake.commands.filter((c) => c.args[0] === 'ACL' && c.args[1] === 'SETUSER')).toEqual([]);
  });

  test('removes a user no longer declared', async () => {
    const fake = makeFakeValkey({ acl: { stale: 'user stale on >h ~stale:* +@read' } });
    const attrs = await run(
      reconcileWithExecutor(fake, { instance: 'valkey-seats', users: {} }, undefined, env),
    );
    expect(attrs.users.stale).toBeUndefined();
    expect(fake.commands.some((c) => c.args[0] === 'ACL' && c.args[1] === 'DELUSER')).toBe(true);
  });

  test('read-back failure when a write does not stick is a typed failure, not a die', async () => {
    // A concurrent mutator re-adds `ghost` after every successful write: every SETUSER reply
    // says OK, so only the read-back — never the write reply — can see the undeclared user.
    const fake = makeFakeValkey({
      reAddAfterWrite: { name: 'ghost', line: 'user ghost on >h ~ghost:* +@read' },
    });
    const error = await fails(reconcileWithExecutor(fake, props(), undefined, env));
    expect(error).toBeInstanceOf(ValkeyAclReadbackFailed);
    expect((error as ValkeyAclReadbackFailed).user).toBe('ghost');
  });
});

describe('read', () => {
  test('reads live ACL users and stores no password value', async () => {
    const fake = makeFakeValkey({ acl: { claude: 'user claude on >h ~claude:* +@read' } });
    const attrs = await run(readWithExecutor(fake, 'valkey-seats'));
    expect(attrs.users.claude?.keyPrefix).toBe('claude:*');
    expect(attrs.users.claude?.passwordSeal).toBe('');
  });
});
