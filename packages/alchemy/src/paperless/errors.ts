/**
 * Paperless-ngx's HTTP status codes, mapped to tagged errors exactly once — here, and never
 * again by a status check inside a resource (S21, alchemy-provider-standard).
 *
 * ⛔ A SINGLE `PaperlessError` CLASS WITH A `.status` FIELD WOULD WORK, AND IS WHAT `netbox/
 *   client.ts` DOES. This family does it the S21 way instead: one tag per distinct MEANING, so a
 *   caller writes `Effect.catchTag('PaperlessNotFound', …)` rather than `if (e.status === 404)`.
 *   `matching.ts`'s "a 403 is never read as absent" rule is exactly what a shared tag buys —
 *   `catchTag('PaperlessNotFound', …)` cannot accidentally also catch `PaperlessUnauthorized`.
 */
import * as Data from 'effect/Data';

/** No object at that path. The only tag `matching.ts` folds to "absent". */
export class PaperlessNotFound extends Data.TaggedError('PaperlessNotFound')<{
  readonly method: string;
  readonly path: string;
}> {}

/** 401 (no/bad token) or 403 (token valid, forbidden) — NEVER read as "the object is absent". */
export class PaperlessUnauthorized extends Data.TaggedError('PaperlessUnauthorized')<{
  readonly status: 401 | 403;
  readonly method: string;
  readonly path: string;
}> {}

/** 400 — the vendor rejected the body. Carries it, so the message quotes Paperless's own words. */
export class PaperlessValidation extends Data.TaggedError('PaperlessValidation')<{
  readonly method: string;
  readonly path: string;
  readonly body: string;
}> {}

/** 5xx, or a status this family's endpoints do not otherwise document. */
export class PaperlessUnavailable extends Data.TaggedError('PaperlessUnavailable')<{
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly detail: string;
}> {}

export type PaperlessError =
  | PaperlessNotFound
  | PaperlessUnauthorized
  | PaperlessValidation
  | PaperlessUnavailable;

/**
 * The one place a status code is read. ⚠️ Anything outside {400,401,403,404,5xx} — 405, 409, 429
 *   — is not documented for these four endpoints, so it falls to `PaperlessValidation` rather than
 *   inventing a fifth tag for a case that was never measured.
 */
export const statusToError = (
  status: number,
  method: string,
  path: string,
  body: string,
): PaperlessError => {
  if (status === 404) return new PaperlessNotFound({ method, path });
  if (status === 401 || status === 403) return new PaperlessUnauthorized({ method, path, status });
  if (status >= 500) return new PaperlessUnavailable({ detail: body, method, path, status });
  return new PaperlessValidation({ body, method, path });
};
