/**
 * Every Proxmox family that writes to the vendor names the endpoint it writes to. All 35 of them.
 *
 * ★ THE TARGET IS THE WHOLE SURFACE, NOT A SAMPLE (Tim, 2026-09-22): "we want 34 of 34 families
 *   I'd think right? no surprises on any of them since we have actual schemas". A family left
 *   unwired is a DEFECT rather than a judgement call — it is a write this repository makes with
 *   nothing between the declaration and the server's 400.
 *
 * ⛔ THIRTY-FIVE, NOT THIRTY-FOUR. `Pbs.NotificationTarget` is absent from the list the sweep
 *   started from, and it writes six endpoints carrying the very rule the incident was about —
 *   `comment: maxLength 128` on all three of its creates, exactly as on `POST /config/verify`.
 *   It is wired with the rest; the count is stated here so the next reader does not inherit the
 *   older number.
 *
 * ★ DERIVED FROM THE OWNERSHIP LEDGER RATHER THAN A SECOND HAND-WRITTEN LIST. `OWNERSHIP` already
 *   names every Resource and every endpoint it calls, and `api-coverage.test.ts` already holds it
 *   to the vendor schema. So a family added there without an `endpoint` declaration fails HERE,
 *   which is the whole point: the census cannot rot into a comment.
 *
 * ⛔ IN `tests/` AND NOT BESIDE THE PROVIDERS, BECAUSE IT IMPORTS `scripts/`. `packages/alchemy/src`
 *   is published; a test in there reaching out of the package would ship a broken import in the
 *   tarball (constraints.test.ts carries the same ⚠️ about `codegen/`).
 */
import { describe, expect, test } from 'bun:test';
import { PROXMOX_CONSTRAINTS } from '../packages/alchemy/src/proxmox/generated/constraints/index.ts';
import { OWNERSHIP } from '../scripts/proxmox-ownership.ts';

/** `pve:POST /pools` — how a generated table keys an endpoint. */
const keyOf = (system: string, method: string, path: string) => `${system}:${method} ${path}`;

/**
 * ⛔ AN OVERCLAIM IN THE OWNERSHIP LEDGER, RECORDED RATHER THAN SILENCED. `Pbs.NotificationTarget`
 *   claims all four notification families through the shared `notificationEndpoints` helper, but
 *   `PbsNotificationTargetType` is `sendmail | smtp | webhook` — there is no gotify type and no
 *   code path that writes one. So these four endpoints are claimed by the ledger and written by
 *   nothing, which is why they are tabled by nothing.
 * ⚠️ NOT FIXED IN PASSING. Correcting the ledger regenerates `docs/api-coverage.{md,json}`, which
 *   is built from a DIFFERENT (older, pve-manager 9.2.4) schema manifest than the constraint
 *   tables — a report-wide diff that belongs in its own change. See
 *   pbs-notification-target-endpoint.ts.
 */
const CLAIMED_BY_NOTHING = new Set([
  'pbs:POST /config/notifications/endpoints/gotify',
  'pbs:PUT /config/notifications/endpoints/gotify/{name}',
]);

/** Every POST/PUT a Resource really sends, by Resource. ⛔ `refuted` and `broken` are excluded. */
const writes = OWNERSHIP.map((row) => {
  const absent = new Set(
    [...(row.refuted ?? []), ...(row.broken ?? [])].map((note) =>
      keyOf(row.system, note.method, note.path),
    ),
  );
  const keys = row.writes
    .filter((claim) => claim.method !== 'DELETE')
    .map((claim) => keyOf(row.system, claim.method, claim.path))
    .filter((key) => !absent.has(key) && !CLAIMED_BY_NOTHING.has(key));
  return { file: row.file, keys, resource: row.resource };
});

describe('every family that writes to Proxmox is wired to the vendor tables', () => {
  test('thirty-five families write, and none of them writes only DELETEs', () => {
    expect(writes.length).toBe(35);
    for (const family of writes) {
      expect(family.keys.length, `${family.resource} (${family.file})`).toBeGreaterThan(0);
    }
  });

  /**
   * ⛔ THE ASSERTION THE WHOLE CHANGE IS FOR. A family whose key is missing here is a family whose
   *   create and update reach the cluster unchecked — the 2026-09-22 shape exactly. The failure
   *   message names the Resource and its file, because the fix is one `endpoint` declaration and
   *   one `bun codegen/constraints.ts`.
   */
  test('every write endpoint a Resource sends has a generated constraint table', () => {
    const missing = writes.flatMap((family) =>
      family.keys
        .filter((key) => PROXMOX_CONSTRAINTS[key] === undefined)
        .map((key) => `${family.resource} (${family.file}): ${key}`),
    );
    expect(missing).toEqual([]);
  });

  /**
   * ⛔ AND THE OTHER DIRECTION, WHICH CATCHES A DIFFERENT MISTAKE. A tabled endpoint no Resource
   *   claims means either the ledger is out of date or a family is writing somewhere the coverage
   *   report has never heard of — and the report is what the estate's gap list is built from.
   */
  test('no endpoint is tabled that the ownership ledger does not claim', () => {
    const claimed = new Set(writes.flatMap((family) => family.keys));
    expect(Object.keys(PROXMOX_CONSTRAINTS).filter((key) => !claimed.has(key))).toEqual([]);
  });

  test('the tabled surface is 75 endpoints across both products', () => {
    const keys = Object.keys(PROXMOX_CONSTRAINTS);
    expect(keys.length).toBe(75);
    expect(keys.filter((key) => key.startsWith('pbs:')).length).toBe(16);
    expect(keys.filter((key) => key.startsWith('pve:')).length).toBe(59);
  });
});

/**
 * ★ THE FAMILIES WHOSE ENDPOINT IS CHOSEN BY A PROP, spelled out so that adding a fourth type to
 *   one of them without adding its key fails here rather than on somebody's deploy. There is no
 *   way to derive this: the generator finds keys by scanning text, which is exactly why the keys
 *   have to be literals in the first place.
 */
describe('the per-type families table every one of their types', () => {
  const tabled = (key: string) => PROXMOX_CONSTRAINTS[key] !== undefined;

  test('Proxmox.NotificationTarget covers all four PVE families', () => {
    for (const type of ['gotify', 'sendmail', 'smtp', 'webhook']) {
      expect(tabled(`pve:POST /cluster/notifications/endpoints/${type}`), type).toBe(true);
      expect(tabled(`pve:PUT /cluster/notifications/endpoints/${type}/{name}`), type).toBe(true);
    }
  });

  test('Pbs.NotificationTarget covers the three families it declares, and not gotify', () => {
    for (const type of ['sendmail', 'smtp', 'webhook']) {
      expect(tabled(`pbs:POST /config/notifications/endpoints/${type}`), type).toBe(true);
      expect(tabled(`pbs:PUT /config/notifications/endpoints/${type}/{name}`), type).toBe(true);
    }
    expect(tabled('pbs:POST /config/notifications/endpoints/gotify')).toBe(false);
  });

  test('Proxmox.CephDaemon covers mds, mgr and mon, each on its own vendor parameter name', () => {
    expect(tabled('pve:POST /nodes/{node}/ceph/mds/{name}')).toBe(true);
    expect(tabled('pve:POST /nodes/{node}/ceph/mgr/{id}')).toBe(true);
    expect(tabled('pve:POST /nodes/{node}/ceph/mon/{monid}')).toBe(true);
  });
});
