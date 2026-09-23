/**
 * ⛔ THIS FILE MUST NOT COMPILE. A reason read out of a variable rather than written at
 *   the call — the loophole that would let an exception ship with nothing in the diff for
 *   a reviewer to read.
 */
import { except } from '../../src/repo-shape.ts';

declare const computed: string;

except({ file: '.github/workflows/ci.yml', reason: computed, since: '2026-09-22' });
