/**
 * `deletePassThroughEndpoint` treats ANY HTTP 400 as "already deleted" — but the vendor's real
 * `DELETE /config/pass_through_endpoint` route also 400s `not_allowed_access` for a non-PROXY_ADMIN
 * caller (or a disconnected DB), on a row that is genuinely still live: `update_config_general_settings`
 * (proxy_server.py:16389-16416 at v1.100.0), the SAME status a missing-id delete gets. Before this
 * file's fix, `client.ts` swallowed that too, silently reporting success while the row stayed live.
 *
 * ⛔ NO MESSAGE SNIFFING (S21): the fix cannot tell the two 400 reasons apart by body text either —
 *   `fake-litellm.ts`'s `forbidDelete` deliberately sends the SAME status the vendor does. It tells
 *   them apart the way `reconcile` already does elsewhere in this file (client.ts's own header:
 *   "read back after writing rather than trusting the call that just returned"): re-list (a GET,
 *   which needs no PROXY_ADMIN — pass_through_endpoints.py:3245-3251) and treat the 400 as
 *   "already gone" only if the row is actually absent.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import {
  type LitellmRequirements,
  deletePassThroughEndpoint,
  listPassThroughEndpoints,
} from './client.ts';
import { litellmCredentialsLayerFor } from './credentials.ts';
import { startFakeLitellm } from './fake-litellm.ts';

const MASTER_KEY = 'sk-test-master';
const PROPS = {
  auth: true,
  id: 'live-1',
  is_from_config: false,
  path: '/bria',
  target: 'https://api.bria.ai',
};

const run = <A, E>(baseUrl: string, effect: Effect.Effect<A, E, LitellmRequirements>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(litellmCredentialsLayerFor({ apiKey: MASTER_KEY, baseUrl })),
    ) as Effect.Effect<A, E, never>,
  );

describe('a delete forbidden for a reason other than "already gone"', () => {
  test('is not swallowed: it fails, and the row is still live', async () => {
    const fake = startFakeLitellm({ forbidDelete: true, masterKey: MASTER_KEY, seed: [PROPS] });
    try {
      const result = run(fake.url, deletePassThroughEndpoint('live-1'));
      await expect(result).rejects.toThrow();
      const rows = await run(fake.url, listPassThroughEndpoints());
      expect(rows.some((r) => r.id === 'live-1')).toBe(true);
    } finally {
      fake.stop();
    }
  });

  test('a genuinely-gone id still succeeds with no error (idempotent delete preserved)', async () => {
    const fake = startFakeLitellm({ forbidDelete: true, masterKey: MASTER_KEY });
    try {
      await expect(
        run(fake.url, deletePassThroughEndpoint('never-existed')),
      ).resolves.toBeUndefined();
    } finally {
      fake.stop();
    }
  });
});
