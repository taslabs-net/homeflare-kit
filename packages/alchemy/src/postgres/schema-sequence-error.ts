import * as Data from 'effect/Data';

/**
 * `cascade: true` on a schema that holds a SEQUENCE is refused (`HF004`, `schema-drop-sql.ts`).
 *
 * ⛔ A sequence cannot be locked by `LOCK TABLE`, so the drop's closure proof has a hole there: a
 *   concurrent, uncommitted `CREATE VIEW other.v AS SELECT last_value FROM ours.seq` is invisible
 *   to the scan, and when it commits while the drop waits on the sequence, PostgreSQL's deletion
 *   cascades into `other.v` (Codex read of PR 357, 2026-10-06). Serial and identity columns each
 *   own a sequence, so such a schema cannot be cascade-dropped by this provider.
 * The message carries a COUNT only. Nothing was dropped: drop the schema's contents deliberately
 * (the sequences included), then declare `cascade: false`.
 */
export class PostgresSchemaCascadeSequencesRefused extends Data.TaggedError(
  'PostgresSchemaCascadeSequencesRefused',
)<{
  readonly schema: string;
  /** How many sequences the schema holds (at least one when raised). */
  readonly sequences: number;
}> {
  override get message(): string {
    return (
      `Postgres.Schema "${this.schema}": cascade: true refused — the schema holds ` +
      `${String(this.sequences)} sequence(s) (serial/identity columns own one), which cannot be ` +
      'locked, so a concurrent dependent could escape the cascade proof. No DROP was issued. ' +
      'Drop the schema contents first, then declare cascade: false.'
    );
  }
}

/** The sequence COUNT out of an `HF004` error; unreadable still refuses (1, never 0). */
export const sequencesCount = (error: {
  readonly reason: { readonly cause?: unknown };
}): number => {
  const cause = error.reason.cause;
  const message = typeof cause === 'object' && cause !== null ? (cause as Error).message : '';
  return Math.max(1, Number(/sequences:\s*(\d+)/.exec(message ?? '')?.[1] ?? 1));
};
