/**
 * ⛔ THIS FILE MUST NOT COMPILE. An exception with an empty reason.
 * ⚠️ DO NOT "FIX" IT — `repo-shape-reason.test.ts` asserts tsc still rejects it. One
 *   refusal per file, so the assertion is "this file errored" and no line number in a
 *   test has to survive the formatter.
 */
import { except } from '../../src/repo-shape.ts';

except({ file: '.github/workflows/ci.yml', reason: '', since: '2026-09-22' });
