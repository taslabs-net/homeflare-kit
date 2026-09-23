/**
 * The vendor's own limits, enforced at plan time — built from the failure that made them necessary.
 *
 * 🔴 2026-09-22, `homeflare-proxmox` `deploy:pbs`: ten objects adopted, then
 *   `POST config/verify -> 400: parameter verification failed - comment: value may only be 128
 *   characters long`. The job was `v-r2-offsite`, the monthly read-back of the R2 copy. Plan,
 *   `bun run check`, the family's own tests and `hf-adopt-verify` were all green, because the only
 *   place the number 128 existed was PBS's published schema.
 *
 * ★ SO THE FIRST TEST IS THAT JOB, WITH A 129-CHARACTER COMMENT, THROUGH ALCHEMY'S OWN ENGINE, and
 *   the assertion that matters is not only the message: it is that `fake.writes()` is EMPTY. The
 *   incident was half a deploy landing before the refusal.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
// ⚠️ The estate's own declarations live in constraints-live.test.ts — split at the 250-line cap.
import { constraintsFor, formViolations } from './constraint-guard.ts';
import { type EndpointConstraints, refusal, violations } from './constraints.ts';
import type { PbsTarget } from './credentials.ts';
import { fakePve, withoutBao } from './fake-pve.ts';
import { PROXMOX_CONSTRAINTS, PROXMOX_CONSTRAINTS_DIGEST } from './generated/constraints/index.ts';
import { PbsVerifyJob, PbsVerifyJobProvider } from './pbs-verify-job.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' };
const VERIFY = 'pbs:POST /config/verify';
const BELL = String.fromCodePoint(7);
const ROCKET = String.fromCodePoint(0x1f680);

/** The real declaration, comment length made an argument. */
const job = (comment: string) =>
  PbsVerifyJob('v-r2-offsite', {
    comment,
    id: 'v-r2-offsite',
    'ignore-verified': true,
    'outdated-after': 30,
    schedule: 'Sun *-1..7 11:00',
    store: 'r2-offsite',
    target: PBS,
  });

describe('the v-r2-offsite failure, refused at plan instead of by the server', () => {
  const deployWith = async (comment: string) => {
    /**
     * A PBS that does not have this job yet, so the plan is a CREATE — the branch `diff` used to
     * skip entirely (`output === undefined` returned before any check). It remembers the POST so
     * the read-back in `reconcile` can succeed, which is what the 128-character case needs.
     */
    const live = new Map<string, Record<string, unknown>>();
    const fake = fakePve((call) => {
      if (call.method === 'GET') return live.get(call.path);
      if (call.method === 'POST') live.set(`config/verify/${String(call.form['id'])}`, call.form);
      return undefined;
    });
    const engine = engineOver(PbsVerifyJobProvider().pipe(Layer.provideMerge(fake.layer)));
    const outcome = await withoutBao(() =>
      engine.deploy(job(comment)).then(
        () => ({ error: undefined as unknown }),
        (error: unknown) => ({ error }),
      ),
    );
    return { ...outcome, calls: fake.calls, writes: fake.writes() };
  };

  test('129 characters is refused, and NOTHING is written', async () => {
    const { calls, error, writes } = await deployWith('c'.repeat(129));
    expect(String(error)).toContain('comment: at most 128 characters');
    expect(String(error)).toContain(VERIFY);
    // ⛔ THE ASSERTION THE INCIDENT IS ABOUT. A refusal after the POST is the server's own 400.
    expect(writes).toEqual([]);
    /**
     * ⚠️ EVERY CALL IS A READ, AND THERE ARE NOW TWO OF THEM. Measured 2026-09-22: Alchemy runs
     *   the provider's `read` handler first, and `reconcile` reads again — the guard moved to
     *   AFTER that second read the same day, because the read is the only thing that says whether
     *   a create or an update is about to be made, and demanding the create form's required
     *   parameters on an update refuses edits that were always legal (resource-guard.ts).
     *   ⛔ THE COUNT IS NOT THE ASSERTION; THE METHOD IS. Nothing is created or changed.
     */
    expect(calls.map((call) => call.method)).toEqual(['GET', 'GET']);
  });

  test('128 characters is accepted and the create goes through', async () => {
    const { error, writes } = await deployWith('c'.repeat(128));
    expect(error).toBeUndefined();
    expect(writes).toEqual(['POST config/verify']);
  });
});

describe('the table is the vendor own rule set, read from the generated file', () => {
  test('POST /config/verify carries the 128 and the safe-id rules PBS publishes', () => {
    const table = constraintsFor(VERIFY);
    expect(table['comment']).toMatchObject({ maxLength: 128, type: 'string' });
    expect(table['id']).toMatchObject({ maxLength: 32, minLength: 3, required: true });
    expect(table['max-depth']).toMatchObject({ maximum: 7, minimum: 0 });
  });

  test('an unknown endpoint is a defect that names the command, not a silent pass', () => {
    expect(() => constraintsFor('pbs:POST /config/nope')).toThrow('bun codegen/constraints.ts');
  });

  /**
   * ⚠️ PBS's `comment` pattern is a POSIX class inside Rust regex delimiters, neither of which
   *   JavaScript reads the same way. `new RegExp` accepts BOTH silently and means something else.
   *   This asserts the translation, because a wrong one refuses every legal comment.
   */
  test('the PBS comment pattern is translated, not copied', () => {
    const rule = constraintsFor(VERIFY)['comment'];
    expect(rule?.patternSource).toContain('cntrl');
    expect(formViolations(VERIFY, { comment: 'nightly read-back of the R2 copy' }, false)).toEqual(
      [],
    );
    expect(formViolations(VERIFY, { comment: `bell${BELL}here` }, false)).toEqual([
      `comment: must match ${rule?.patternSource ?? ''}`,
    ]);
  });

  /**
   * ⚠️ THE SORT IS PART OF THE DIGEST, and it is spelled out here rather than imported from
   *   `codegen/emit.ts`: `src/` is published, and a test that reached out of the package would
   *   ship a broken import in the tarball. The generator sorts for the same reason it must be
   *   sorted here — it merges per area, this module spreads per import.
   */
  test('the committed tables match their own digest, so no value was hand-edited', () => {
    const sorted = Object.fromEntries(
      Object.keys(PROXMOX_CONSTRAINTS)
        .sort()
        .map((key) => [key, PROXMOX_CONSTRAINTS[key]]),
    );
    const recomputed = new Bun.CryptoHasher('sha256')
      .update(JSON.stringify(sorted))
      .digest('hex')
      .slice(0, 16);
    expect(recomputed).toBe(PROXMOX_CONSTRAINTS_DIGEST);
  });
});

/**
 * ★ ONE MUTANT PER BRANCH. Each case below fails if that single comparison is deleted, inverted or
 *   its boundary moved by one — which is the only way to know the validator checks what it claims
 *   rather than passing everything.
 */
describe('every rule kind, at and past its boundary', () => {
  const table: EndpointConstraints = {
    depth: { maximum: 7, minimum: 0, type: 'integer' },
    mode: { enum: ['all', 'any'], type: 'string' },
    name: { maxLength: 4, minLength: 2, pattern: '^[a-z]+$', patternSource: '/^[a-z]+$/' },
    store: { required: true, type: 'string' },
    tags: { maxLength: 3, type: 'string' },
  };
  const at = (form: Record<string, string | readonly string[]>, presence = false) =>
    violations(table, form, { presence });

  test('maxLength: 4 passes, 5 does not', () => {
    expect(at({ name: 'abcd' })).toEqual([]);
    expect(at({ name: 'abcde' })).toEqual(['name: at most 4 characters']);
  });

  test('minLength: 2 passes, 1 does not', () => {
    expect(at({ name: 'ab' })).toEqual([]);
    expect(at({ name: 'a' })).toEqual(['name: at least 2 characters']);
  });

  test('minimum and maximum are inclusive on both sides', () => {
    expect(at({ depth: '0' })).toEqual([]);
    expect(at({ depth: '7' })).toEqual([]);
    expect(at({ depth: '-1' })).toEqual(['depth: at least 0']);
    expect(at({ depth: '8' })).toEqual(['depth: at most 7']);
  });

  test('enum quotes the vendor own members', () => {
    expect(at({ mode: 'any' })).toEqual([]);
    expect(at({ mode: 'ALL' })).toEqual(['mode: must be one of all, any']);
  });

  test('pattern reports the VENDOR spelling, not the translated one', () => {
    expect(at({ name: 'abc' })).toEqual([]);
    expect(at({ name: 'ab1' })).toEqual(['name: must match /^[a-z]+$/']);
  });

  test('required is checked only when presence is asked for — an update form is partial', () => {
    expect(at({})).toEqual([]);
    expect(at({}, true)).toEqual(['store: required']);
    expect(at({ store: 'r2' }, true)).toEqual([]);
  });

  /** ⚠️ Characters, not UTF-16 code units: an astral character is ONE character to Proxmox. */
  test('length counts characters, so an astral character is one', () => {
    expect(at({ tags: `${ROCKET}ab` })).toEqual([]);
    expect(at({ tags: `${ROCKET}abc` })).toEqual(['tags: at most 3 characters']);
  });

  /** ⚠️ A list is repeated keys on the wire (client.ts), so every element faces the same rule. */
  test('every element of an array value is checked', () => {
    expect(at({ tags: ['ab', 'abcd'] })).toEqual(['tags: at most 3 characters']);
  });

  test('a key the table does not mention is not an error', () => {
    expect(at({ unlisted: 'anything at all' })).toEqual([]);
  });

  test('the refusal names the endpoint and points at the generated table', () => {
    expect(refusal(VERIFY, ['comment: at most 128 characters'])).toContain(VERIFY);
    expect(refusal(VERIFY, ['comment: at most 128 characters'])).toContain('generated/constraints');
  });
});
