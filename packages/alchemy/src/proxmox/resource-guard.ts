/**
 * A spec's two forms, checked against the vendor's own tables before either goes on the wire.
 *
 * ★ A FILE OF ITS OWN BECAUSE resource.ts REACHED THE 250-LINE CAP, and the seam is the same one
 *   resource-spec.ts cuts on: that file says what a PVE object DECLARES, resource.ts says how one
 *   is read and written, and this one says what makes a declaration legal. `constraint-guard.ts`
 *   is the layer below — it owns the lookup and the refusal; this owns which form to check when.
 */
import * as Effect from 'effect/Effect';
import { guardForm } from './constraint-guard.ts';
import type { PveSpec, WithApiTarget } from './resource-spec.ts';

export const specGuards = <Props extends WithApiTarget, Attributes>(
  spec: PveSpec<Props, Attributes>,
) => {
  /** ⚠️ A function for the two families whose endpoint is a prop — see `PveSpec['endpoint']`. */
  const endpointsOf = (props: Props) =>
    typeof spec.endpoint === 'function' ? spec.endpoint(props) : spec.endpoint;

  /**
   * The create form against its own endpoint's table.
   *
   * ⛔ `presence` MEANS "A CREATE IS REALLY ABOUT TO HAPPEN", NOT "THIS IS THE CREATE FORM", AND
   *   THE DIFFERENCE IS A WHOLE FAMILY. `Proxmox.NotificationTarget` cannot send gotify's `token`
   *   or smtp's `password` — they are write-only secrets and props are persisted to the state
   *   store unencrypted (notification-target.ts's third ⛔) — so PVE's `token: required` is
   *   permanently unsatisfiable here. The documented way to run one is to create it out of band
   *   with its secret and then DECLARE it, which is an adopt and then updates forever after.
   *   Requiring the create form's parameters on that path would refuse a deploy that has worked
   *   all along, which is the one failure worse than the 400 this feature removes.
   * ⚠️ VALUE RULES STILL RUN ON EVERY PLAN, presence or not: a 129-character comment is wrong
   *   whether it is being created or edited, and that is the case this whole feature exists for.
   *
   * ⛔ THE FORM IS BUILT ONLY WHEN THERE IS A TABLE TO CHECK IT AGAINST. Calling `spec.createForm`
   *   unconditionally would run every family's form builder on every diff — work nobody asked
   *   for, and a new way for a builder that throws on an update-only path to break a plan it
   *   never touched.
   */
  const guardCreate = (props: Props, presence: boolean): Effect.Effect<void> =>
    Effect.suspend(() => {
      const create = endpointsOf(props)?.create;
      return create === undefined
        ? Effect.void
        : guardForm(create, spec.createForm(props), presence);
    });

  /**
   * ⛔ NEVER WITH PRESENCE. An update form is deliberately PARTIAL — `formToSend` sends the fields
   *   that changed and nothing else — so requiring the vendor's required parameters here would
   *   refuse every ordinary edit. Value rules (length, range, enum, pattern) apply to both forms.
   */
  const guardUpdate = (props: Props): Effect.Effect<void> =>
    Effect.suspend(() => {
      const update = endpointsOf(props)?.update;
      if (update === undefined) return Effect.void;
      const form = spec.updateForm?.(props);
      return form === undefined ? Effect.void : guardForm(update, form, false);
    });

  return { guardCreate, guardUpdate };
};
