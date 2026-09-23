/**
 * `Pbs.Datastore`'s two vendor endpoints, and the plan-time check over its two forms.
 *
 * ★ A FILE OF ITS OWN BECAUSE THIS FAMILY DOES NOT USE `pveHandlers`. It writes its own `diff` and
 *   `reconcile` (a create answers with a task id, so it settles rather than reading back once), so
 *   it cannot inherit the guard from resource.ts — and a copy of the two calls inside that already
 *   long file is exactly the per-resource copy-paste the shared handler exists to prevent.
 *
 * ⛔ THE FOUR FIELDS THAT MADE THIS WORTH DOING, from the PBS 4.2.6 schema: `comment` is
 *   maxLength 128 with a no-control-characters pattern, `name` is 3..32 with a safe-id pattern,
 *   and every `keep-*` has minimum 1. All four were `string`/`number` with the limits in prose.
 */
import * as Effect from 'effect/Effect';
import { guardForm } from './constraint-guard.ts';
import type { EndpointKey } from './constraints.ts';
import { createForm, updateForm } from './pbs-datastore-form.ts';
import type { PbsDatastoreProps } from './pbs-datastore.ts';

export const DATASTORE_ENDPOINT: { readonly create: EndpointKey; readonly update: EndpointKey } = {
  create: 'pbs:POST /config/datastore',
  update: 'pbs:PUT /config/datastore/{name}',
};

/** ⚠️ Presence on create only — an update form is partial by design (update-guard.ts). */
export const guardDatastoreForms = (props: PbsDatastoreProps): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* guardForm(DATASTORE_ENDPOINT.create, createForm(props), true);
    yield* guardForm(DATASTORE_ENDPOINT.update, updateForm(props), false);
  });
