/**
 * A stack the `hf-adopt-verify` bin can import from disk, with no network and no state on disk:
 * the fake family from src/verify/fake-engine.ts over a fixed cloud, and an in-memory state store.
 *
 * ★ THREE ROWS, ONE OF EACH VERDICT: `same` matches (adopted, noop), `drifted` does not (adopted,
 *   update), `fresh` is not there (create). tests/verify-cli.test.ts reads the report back.
 */
import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';
import { Thing, cloudOf, thingProviders } from '../../src/verify/fake-engine.ts';

const cloud = cloudOf({ drifted: 'old', same: 'x' });

// oxlint-disable no-default-export -- Alchemy's CLI (and hf-adopt-verify) load the default export.
export default Alchemy.Stack(
  'VerifyFixture',
  { providers: thingProviders(cloud), state: Alchemy.inMemoryState() },
  Effect.all([
    Thing('same', { comment: 'x', name: 'same' }),
    Thing('drifted', { comment: 'new', name: 'drifted' }),
    Thing('fresh', { name: 'fresh' }),
  ]),
);
