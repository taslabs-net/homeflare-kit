/**
 * ★ THIS FILE MUST COMPILE. The same two calls with reasons written at the call site.
 *   A guard that refuses everything is not a guard, it is a wall — so the test asserts
 *   both halves, and an over-tightening shows up as a failure rather than as friction.
 */
import { except, extraJob } from '../../src/repo-shape.ts';

except({
  file: '.github/workflows/ci.yml',
  reason: 'Payload needs Node >=24.15, which the rendered job does not install',
  since: '2026-09-22',
});

extraJob({
  id: 'build',
  name: 'build',
  reason: 'this repository ships a Vite frontend the Worker serves; no other one does',
  steps: [{ run: 'bun run build:web' }],
});
