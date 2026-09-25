/**
 * A real `Alchemy.Stack` whose body `yield*`s `LiteLLM.PassThroughEndpoint`, with
 * `litellmProviders` as the providers layer.
 *
 * ⛔ THE TYPE IS THE BUG. The resource used to put `LitellmRequirements`
 *   (`Credentials | HttpClient`) on its 5th type parameter, so this construction failed
 *   TS2345: `Credentials` is not `ProviderServices | StackServices`
 *   (`"LitellmCredentials"` is not `"Stack"`). No cast. `tsc` fails again if that leak
 *   returns. The stack value is not run — `Alchemy.Stack` returns a lazy effect
 *   (github/repo-policy-stack.test.ts measured the same).
 *
 * ★ THE DEPLOY IS THE OTHER HALF. `fakeStack` runs Alchemy's own Plan and Apply over the
 *   fake proxy, and its providers layer is `litellmProviders` (`fake-stack.ts`). A sealed
 *   `Layer.provide` builds the provider and then hides `Credentials`, so `reconcile` dies
 *   with Service not found before any request. A live row means the handler ran with the
 *   key present.
 */
import { expect, test } from 'bun:test';
import { credentials } from '@distilled.cloud/litellm/Credentials';
import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';
import { FAKE_BASE, startFakeLitellm } from './fake-litellm.ts';
import { fakeStack } from './fake-stack.ts';
import { LiteLLMPassThroughEndpoint } from './pass-through-endpoint.ts';
import { litellmProviders } from './providers.ts';

const MASTER_KEY = 'sk-test-master';
const props = { path: '/bria', target: 'https://api.bria.ai' };

test('an Alchemy.Stack body can yield LiteLLMPassThroughEndpoint, and apply reaches the proxy', async () => {
  const stack = Alchemy.Stack(
    'litellm-passthrough',
    {
      providers: litellmProviders(credentials({ apiKey: MASTER_KEY, baseUrl: FAKE_BASE })),
      state: Alchemy.inMemoryState(),
    },
    Effect.gen(function* () {
      return yield* LiteLLMPassThroughEndpoint('Endpoint', props);
    }),
  );
  // Not run — see the file header. `tsc` is the assertion on this value.
  expect(stack).toBeDefined();

  const fake = startFakeLitellm({ masterKey: MASTER_KEY });
  const planned = await fakeStack({ apiKey: MASTER_KEY, baseUrl: FAKE_BASE }, fake.fetch).deploy(
    Effect.gen(function* () {
      yield* LiteLLMPassThroughEndpoint('Endpoint', props);
    }),
  );

  expect(planned).toEqual({ Endpoint: 'create' });
  expect(fake.rows().some((row) => row.path === '/bria')).toBe(true);
  expect(fake.requests().some((call) => call.method === 'POST')).toBe(true);
});
