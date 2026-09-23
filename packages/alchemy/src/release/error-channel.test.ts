/**
 * What a caller can actually catch from Release.Binary — MEASURED, so docs/release-binary-upstream.md
 * cannot claim more than is true. (The upstream-lens review of 2026-09-22 found it claiming
 * "callers can `catchTag`"; neither path below allows it.)
 *
 * ⚠️ catalogBinary() THROWS. In a stack program (`Effect.gen`) its BinaryRefused is therefore a
 *   DEFECT, not a typed failure: `Effect.catchTag('BinaryRefused')` never sees it. The plan still
 *   fails before anything is fetched — the house guarantee holds — but the error is not typed.
 * ⚠️ THE PROVIDER'S CHANNEL IS `Error`. Every lifecycle call goes through the house `lift()`
 *   (launchd/host-effect.ts), which keeps the tagged instance at runtime but types the channel as
 *   plain `Error`, so no caller can name a tag without a cast — which upstream's AGENTS.md forbids.
 * ★ WHEN EITHER BECOMES TYPED, THIS FILE FAILS FIRST: the defect assertions flip, or the
 *   `@ts-expect-error` below becomes unused and `tsc` refuses it. Update the upstream page with it.
 */
import { describe, expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { lift } from '../launchd/host-effect.ts';
import { catalogBinary } from './catalog.ts';
import { BinaryRefused, ChecksumMismatch } from './refused.ts';
import { VICTORIA_RELEASES } from './victoria.ts';

const UNPINNED = {
  binary: 'vmalert',
  package: 'vmutils',
  platform: 'darwin-arm64',
  version: '1.152.0',
};

describe('the stack program: catalogBinary', () => {
  test('a refusal fails the program as a defect carrying BinaryRefused, not a typed failure', async () => {
    // The shape of a stack program: it yields its resources, and calls catalogBinary() plainly.
    const program = Effect.gen(function* () {
      yield* Effect.void;
      return catalogBinary(VICTORIA_RELEASES, UNPINNED);
    });
    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.hasFails(exit.cause)).toBe(false);
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(Cause.squash(exit.cause)).toBeInstanceOf(BinaryRefused);
  });
});

describe('the provider: lift()', () => {
  const mismatch = new ChecksumMismatch({
    actual: '0'.repeat(64),
    expected: '1'.repeat(64),
    message: 'Release.Binary /x/y: hashes wrong. Nothing was written.',
    subject: 'member "y"',
  });

  test('the tagged instance survives at runtime, as a failure', async () => {
    const exit = await Effect.runPromiseExit(lift(() => Promise.reject(mismatch)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.hasFails(exit.cause)).toBe(true);
    expect(Cause.squash(exit.cause)).toBe(mismatch);
  });

  test('but the channel is typed `Error`, so a tag cannot be named without a cast', () => {
    const lifted = lift(() => Promise.reject(mismatch));
    // @ts-expect-error — lift() erases the tag union to `Error`; see the file header.
    const caught = Effect.catchTag(lifted, 'ChecksumMismatch', () => Effect.succeed('caught'));
    expect(Effect.isEffect(caught)).toBe(true);
  });
});
