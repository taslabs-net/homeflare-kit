/**
 * The runtime guards `repo-shape` needs and its types cannot express.
 *
 * ★ EXTRACTED FROM `shape.ts`, NOT INVENTED HERE. The types carry one half of the
 *   contract — `Stated<R>` refuses an empty or computed reason at compile time — and
 *   these carry the other half: the cases a literal type still lets through. Keeping
 *   them in one file is what lets `shape.ts` stay the declaration and nothing else.
 *
 * ⚠️ EVERY MESSAGE STARTS `repo-shape:` AND NAMES THE FIELD. These throw at render or at
 *   declaration, far from the workflow file they would otherwise break at job time, so
 *   the message is the only thing pointing back at the call that caused it.
 */

const SENTENCE = 12;

export function requireNonEmpty(field: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`repo-shape: ${field} must not be blank`);
  return trimmed;
}

export function requireSentence(field: string, value: string): string {
  const trimmed = value.trim();
  // ⚠️ THE TYPE CANNOT CATCH `reason: '   '`. `'   '` is a non-empty literal, so `Stated`
  //   lets it through and only this does not. Type and guard cover different halves.
  if (trimmed.length < SENTENCE) {
    throw new Error(`repo-shape: ${field} must be a sentence, got ${JSON.stringify(value)}`);
  }
  return trimmed;
}

export function requireIsoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`repo-shape: since must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * A retired file names the `@homeflare/config` release that stopped rendering it, so
 * anyone reading `retired.ts` can find the changeset that made the call.
 */
export function requireSemver(value: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`repo-shape: retiredIn must be a released x.y.z, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * ⛔ A MAJOR, NOT A RANGE, AND NOT A FLOAT. `actions/setup-node` takes `node-version: 24`
 *   and resolves the newest 24.x; a fractional or negative value renders YAML the action
 *   accepts and then fails to resolve, mid-job, on the runner.
 */
export function requireMajor(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`repo-shape: node must be a positive integer major, got ${value}`);
  }
  return value;
}

/** `timeout-minutes` must be a positive whole number of minutes. */
export function requireMinutes(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`repo-shape: timeout must be a positive whole minute count, got ${value}`);
  }
  return value;
}

export function requireJobId(value: string): string {
  // ⛔ The id becomes a YAML key and a `needs:` entry. Anything else renders a workflow
  //   GitHub rejects at parse time, which reports as "workflow file issue" with no line.
  if (!/^[a-z][a-z0-9_-]*$/.test(value)) {
    throw new Error(
      `repo-shape: job id must match /^[a-z][a-z0-9_-]*$/, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}
