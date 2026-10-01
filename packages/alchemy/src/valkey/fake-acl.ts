/** ACL state model for the recording fake. Valkey's ACL docs specify additive SETUSER,
 * reset, hash-only LIST echoes, and channel checks; this is not a complete ACL evaluator. */
import { createHash } from 'node:crypto';
/** One user's ACL state — the fake's parsed mirror of what a real server keeps per user. */
export interface FakeAclUser {
  on: boolean;
  nopass: boolean;
  /** The stored `#<sha256>` tokens, empty when the user has no passwords. */
  passwords: ReadonlyArray<string>;
  /** Key patterns with their `~`, e.g. `['~claude:*']`. */
  keys: ReadonlyArray<string>;
  /** Channel patterns with their `&`; `['&*']` is what `allchannels` echoes as. */
  channels: ReadonlyArray<string>;
  /** The `+`/`-` rule tokens, with the `-@all` baseline the echo keeps. */
  rules: ReadonlyArray<string>;
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** A user straight out of `reset`: off, no password, no patterns, the `-@all` baseline. */
export const freshUser = (): FakeAclUser => ({
  on: false,
  nopass: false,
  passwords: [],
  keys: [],
  channels: [],
  rules: ['-@all'],
});

/** Apply one `ACL SETUSER` rule token, in order — the fake's model of the server's own
 * incremental semantics (`reset` resets, `+@all` cancels the `-@all` baseline, and so on). */
export const applyToken = (user: FakeAclUser, token: string): void => {
  switch (token) {
    case 'reset':
      Object.assign(user, freshUser());
      break;
    case 'reseton':
    case 'resetoff':
      user.on = false;
      break;
    case 'resetkeys':
      user.keys = [];
      break;
    case 'resetchannels':
      user.channels = [];
      break;
    case 'resetpass':
      user.passwords = [];
      user.nopass = false;
      break;
    case 'on':
      user.on = true;
      break;
    case 'off':
      user.on = false;
      break;
    case 'nopass':
      user.nopass = true;
      user.passwords = [];
      break;
    case 'allkeys':
      user.keys = ['~*'];
      break;
    case 'allchannels':
      user.channels = ['&*'];
      break;
    default:
      if (token.startsWith('#')) {
        user.passwords = [...new Set([...user.passwords, token])];
        user.nopass = false;
      } else if (token.startsWith('>')) {
        user.passwords = [...new Set([...user.passwords, `#${sha256(token.slice(1))}`])];
        user.nopass = false;
      } else if (token.startsWith('<') || token.startsWith('!')) {
        const hash = token[0] === '<' ? sha256(token.slice(1)) : token.slice(1);
        user.passwords = user.passwords.filter((password) => password !== `#${hash}`);
      } else if (token.startsWith('~')) {
        user.keys = [...user.keys, token];
      } else if (token.startsWith('&')) {
        user.channels = [...user.channels, token];
      } else if (token === '-@all' || token === '+@all') {
        user.rules = [token];
      } else if (token.startsWith('+') || token.startsWith('-')) {
        const rules = [...user.rules];
        const i = rules.indexOf(token);
        if (i >= 0) rules.splice(i, 1);
        user.rules = [...rules, token];
      }
  }
};

/** The `ACL LIST` echo for one user — the MEASURED shape: flags, password hash, key patterns,
 * the bare `resetchannels` marker before the channel patterns, then the rule tokens. */
export const renderUser = (name: string, user: FakeAclUser): string =>
  [
    'user',
    name,
    user.on ? 'on' : 'off',
    user.nopass ? 'nopass' : '',
    ...user.passwords,
    ...user.keys,
    'resetchannels',
    ...user.channels,
    ...user.rules,
  ]
    .filter((part) => part !== '')
    .join(' ');

/** Tokenize a seeded `ACL LIST` line the way the fake would have stored the SETUSER that made
 * it, so a seed and a write land in the same shape. */
export const seedUser = (line: string): FakeAclUser => {
  const user = freshUser();
  const parts = line.split(' ');
  if (parts[2] === 'on' || parts[2] === 'off') applyToken(user, parts[2]);
  for (const part of parts.slice(3)) applyToken(user, part);
  return user;
};

/** Does `channel` match one of the session user's `&` patterns? Glob, the way the server's
 * `&pat:*` works for PUBLISH. */
export const channelAllowed = (user: FakeAclUser, channel: string): boolean =>
  user.channels.some((pattern) => {
    const glob = pattern
      .slice(1)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${glob}$`).test(channel);
  });
