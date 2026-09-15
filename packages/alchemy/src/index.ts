/**
 * What a stack in this repo imports. ⛔ NOTHING ELSE IS RE-EXPORTED: codex standard 3 refuses an
 * export with no consumer, and `husky/knip-gate.ts` fails on a new orphan rather than listing it.
 * The lifecycle functions and the equality helper are imported by this package's own tests from
 * their modules, which is where a reader looking for them should land anyway.
 */
export type { R2LockRule } from './lock-rules.ts';
export { R2BucketLock, type R2BucketLockProps } from './r2-bucket-lock.ts';
