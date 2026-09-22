/**
 * The whole live PBS estate, through its own create and update tables, expecting NOTHING.
 *
 * ⛔ THIS IS THE RISK THE CONSTRAINT GUARD CARRIES, NOT THE ONE IT FIXES. A table that refuses a
 *   declaration the vendor would have ACCEPTED blocks a deploy that was always legal, and the
 *   operator cannot tell that from a genuine violation. `guardForms` runs in `diff` AND in
 *   `reconcile`, and `reconcile` runs for an ADOPTED row — so every object the estate has already
 *   adopted faces these tables on its next plan. A false positive here is a broken plan for ten
 *   live objects, including a datastore holding the offsite copies.
 *
 * ★ THE VALUES ARE THE LIVE ONES, read from homeflare-proxmox's own inventory fixture
 *   (`tests/fixtures/pbs-live-2026-09-21.json`, captured read-only 2026-09-21): the ten objects
 *   PBS actually holds, with their real ids, stores, schedules and retention numbers.
 *   ⚠️ EXCEPT THE COMMENT TEXT, WHICH IS REPLACED BY A STRING OF THE SAME CHARACTER LENGTH. This
 *     package is public and the live comments name hosts and runbook paths. Length and character
 *     class are the whole of what a `maxLength`/`pattern` rule sees, so the substitution costs the
 *     test nothing — and the lengths (106, 116, 88, 107, 120) are the live ones, asserted below.
 */
import { describe, expect, test } from 'bun:test';
import { formViolations } from './constraint-guard.ts';
import type { PbsTarget } from './credentials.ts';
import { createForm as datastoreCreateForm, updateForm } from './pbs-datastore-form.ts';
import { createBody as pruneCreateBody, updateBody as pruneUpdate } from './pbs-prune-job-form.ts';
import { createBody as syncCreateBody, updateBody as syncUpdate } from './pbs-sync-job-form.ts';
import type { PbsVerifyJobProps } from './pbs-verify-job.ts';
import { shape as verifyShape } from './pbs-verify-job-form.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' };
const filler = (length: number) => 'c'.repeat(length);

/** What `pbs-verify-job.ts` builds inline for a create: the update shape plus the required `id`. */
const verifyCreate = (props: PbsVerifyJobProps) => ({ ...verifyShape(props), id: props.id });

describe('every live PBS object passes its own create table', () => {
  test('the three prune jobs, including the parked one', () => {
    for (const job of [
      { id: 'prune-cluster-all', keep: 3, schedule: 'Sat 06:00', store: 'cluster' },
      { comment: filler(88), id: 'prune-datacenter-all', keep: 3, store: 'datacenter' },
      { id: 'prune-r2-offsite-all', keep: 3, schedule: 'Sat 07:30', store: 'r2-offsite' },
    ]) {
      const form = pruneCreateBody({
        ...job,
        'keep-daily': 7,
        'keep-last': job.keep,
        'keep-monthly': 3,
        'keep-weekly': 4,
        'max-depth': 7,
        schedule: job.schedule ?? 'Sat 08:00',
        target: PBS,
      });
      expect([job.id, formViolations('pbs:POST /config/prune', form, true)]).toEqual([job.id, []]);
    }
  });

  /**
   * ⚠️ `sync-all-to-dc` HAS NO `schedule` AND `v-datacenter` HAS NEITHER `schedule` NOR `ns`. Both
   *   are parked, and both are legal: PBS marks `schedule` optional on sync and verify jobs. If
   *   the presence check ever read `required` from the wrong place, these two rows are what fails.
   */
  test('the two sync jobs, one of them parked with no schedule', () => {
    const parked = syncCreateBody({
      comment: filler(107),
      id: 'sync-all-to-dc',
      'max-depth': 7,
      'remote-store': 'cluster',
      'remove-vanished': false,
      store: 'datacenter',
      target: PBS,
      'verified-only': true,
    });
    expect(formViolations('pbs:POST /config/sync', parked, true)).toEqual([]);
    const live = syncCreateBody({
      id: 'sync-all-to-r2',
      owner: 'root@pam',
      'remote-store': 'cluster',
      schedule: '08:30',
      store: 'r2-offsite',
      target: PBS,
    });
    expect(formViolations('pbs:POST /config/sync', live, true)).toEqual([]);
  });

  /**
   * ⚠️ `{...shape(props), id}` IS THE CREATE FORM, SPELLED OUT. `pbs-verify-job.ts` builds it
   *   inline and exports only `shape`, which is the UPDATE form and carries no `id` — and `id` is
   *   one of the two parameters PBS marks required on this endpoint. Calling `shape` here and
   *   expecting no violations reported `id: required`, which is the presence check working, not a
   *   defect. If that inline `id` is ever dropped, this test is what says so.
   * ⚠️ `ns: ''` IS A LIVE VALUE AND `shape` DROPS IT rather than sending the empty string, so the
   *   table never sees it. The vendor's pattern would accept it either way — it ends `)?$`.
   */
  test('the two verify jobs, one with an empty namespace', () => {
    const running = verifyCreate({
      id: 'v-b7d7ff81-17d6',
      'ignore-verified': true,
      ns: '',
      'outdated-after': 30,
      schedule: '06:30',
      store: 'cluster',
      target: PBS,
    });
    expect(formViolations('pbs:POST /config/verify', running, true)).toEqual([]);
    const parked = verifyCreate({
      comment: filler(120),
      id: 'v-datacenter',
      'ignore-verified': true,
      'outdated-after': 30,
      schedule: null,
      store: 'datacenter',
      target: PBS,
    });
    expect(formViolations('pbs:POST /config/verify', parked, true)).toEqual([]);
  });

  test('the three datastores, on create and on update', () => {
    for (const store of [
      { comment: filler(106), name: 'cluster', path: '/mnt/datastore/cluster' },
      { comment: filler(116), name: 'datacenter', path: '/mnt/cluster_pbs' },
      { comment: filler(106), name: 'r2-offsite', path: '/mnt/datastore/r2-cache' },
    ]) {
      const props = { ...store, target: PBS };
      expect([
        store.name,
        formViolations('pbs:POST /config/datastore', datastoreCreateForm(props), true),
      ]).toEqual([store.name, []]);
      // ⚠️ THE UPDATE FORM IS PARTIAL BY DESIGN, so presence is off — value rules still apply.
      expect([
        store.name,
        formViolations('pbs:PUT /config/datastore/{name}', updateForm(props), false),
      ]).toEqual([store.name, []]);
    }
  });

  test('the prune and sync update forms, which send only what changed', () => {
    const prune = pruneUpdate({
      id: 'prune-cluster-all',
      'keep-daily': 7,
      'keep-last': 3,
      'max-depth': 7,
      schedule: 'Sat 06:00',
      store: 'cluster',
      target: PBS,
    });
    expect(formViolations('pbs:PUT /config/prune/{id}', prune, false)).toEqual([]);
    const sync = syncUpdate({
      id: 'sync-all-to-r2',
      owner: 'root@pam',
      'remote-store': 'cluster',
      schedule: '08:30',
      store: 'r2-offsite',
      target: PBS,
    });
    expect(formViolations('pbs:PUT /config/sync/{id}', sync, false)).toEqual([]);
  });
});
