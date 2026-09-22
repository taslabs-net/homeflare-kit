/**
 * ⛔ THIS FILE MUST NOT COMPILE. An extra job with no stated reason: the same rule as an
 *   exception, because a job the standard does not have is a deviation too.
 */
import { extraJob } from '../../src/repo-shape.ts';

extraJob({ id: 'build', name: 'build', reason: '', steps: [{ run: 'true' }] });
