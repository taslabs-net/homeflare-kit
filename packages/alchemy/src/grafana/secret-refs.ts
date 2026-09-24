/**
 * Shared "secret stays in env, never in state" resolution (S25) for this family —
 * `Grafana.Datasource`'s `secureJsonDataRefs` and `Grafana.ContactPoint`'s `secureSettingsRefs`
 * are the identical shape: a map of field name to an env var NAME, resolved fresh from
 * `process.env` inside the caller's own create/update effect (S24), never at plan time and never
 * returned in `attributes`. Extracted here once a second family needed the exact same loop
 * `datasource.ts` already had — see that file's original note for why this exists at all:
 * Grafana's own read APIs never return a secret value, only whether one is set
 * (`DataSource.secureJsonFields`'s booleans; a contact point's `settings` comes back with secure
 * keys replaced by a literal redaction placeholder instead — see contact-point.ts).
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';

/** A named secure-field env var is unset — a domain refusal, not a distilled error. */
export class GrafanaSecretRefUnsetError extends Data.TaggedError('GrafanaSecretRefUnsetError')<{
  readonly message: string;
}> {}

/**
 * Reads every named env var fresh, inside the caller's effect (S24) — never at plan time.
 * `describeField` builds the refusal message's own field-specific phrase — each caller names its
 * declaration path differently (`secureJsonData.<field>` for a datasource,
 * `settings.<field>` for a contact point) — so the message stays accurate to what the caller
 * itself declares.
 */
export const resolveSecretRefs = (
  refs: Record<string, string> | undefined,
  describeField: (field: string) => string,
): Effect.Effect<Record<string, string> | undefined, GrafanaSecretRefUnsetError> =>
  Effect.gen(function* () {
    if (refs === undefined) return undefined;
    const out: Record<string, string> = {};
    for (const [field, envVar] of Object.entries(refs)) {
      const raw = process.env[envVar];
      if (raw === undefined || raw.trim() === '') {
        return yield* Effect.fail(
          new GrafanaSecretRefUnsetError({
            message:
              `${envVar} is unset. Export the value of ${describeField(field)} there — ` +
              'never as an Alchemy prop.',
          }),
        );
      }
      out[field] = raw.trim();
    }
    return out;
  });
