/**
 * The published seat example must emit the key pattern CT100 already renders.
 * `homeflare-ct100/src/valkey-acl.ts` `seatLine` is `~${user}:*` (`~claude:*`).
 * A kit example of `seat:claude:*` would `reset` that user onto `~seat:claude:*`
 * and the next template render would put `~claude:*` back.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { buildSetUserArgs } from './acl-form.ts';
import type { ValkeyAclUser } from './acl-attrs.ts';

const templatePattern = (user: string): string => `~${user}:*`;

describe('published key prefix', () => {
  test("example declaration's ~ pattern equals the CT100 seat template", async () => {
    const doc = readFileSync(new URL('../../docs/valkey.md', import.meta.url), 'utf8');
    const examples = [...doc.matchAll(/name: '(\w+)',\s*\n\s*keyPrefix: '([^']+)'/g)].map(
      (match) => ({ name: match[1] ?? '', keyPrefix: match[2] ?? '' }),
    );
    expect(examples).toEqual([
      { name: 'claude', keyPrefix: 'claude:*' },
      { name: 'grok', keyPrefix: 'grok:*' },
    ]);
    for (const example of examples) {
      const user: ValkeyAclUser = {
        name: example.name,
        keyPrefix: example.keyPrefix,
        profile: 'seat',
        password: { fromEnv: 'X' },
      };
      expect(await Effect.runPromise(buildSetUserArgs(user, 'FAKE-password'))).toContain(
        templatePattern(example.name),
      );
      expect(`~${example.keyPrefix}`).toBe(templatePattern(example.name));
    }
  });
});
