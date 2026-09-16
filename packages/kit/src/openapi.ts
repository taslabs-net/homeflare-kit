/**
 * OpenAPIHono with one validation hook — the document and the request share a schema.
 *
 * ★ WHY @hono/zod-openapi AND NOT HAND-ROLLED CHECKS. A Worker that validates in the
 *   handler and generates OpenAPI from a parallel registry has two truths. They agree
 *   only while somebody keeps them in step; a wrong-typed field silently becomes
 *   `undefined` and the caller is told nothing. zod-openapi generates the document from
 *   the same schema that validates the request.
 *
 * ⛔ THIS IS A SUBPATH (`@homeflare/kit/openapi`), NEVER THE MAIN ENTRY. Hono is a
 *   Worker/HTTP framework. A Node script depending on `@homeflare/kit` must not resolve
 *   it. Import this only from a Worker or an HTTP app.
 *
 * ⚠️ Import `z` from `@hono/zod-openapi`, not from `zod`. The OpenAPI helpers
 *   (`.openapi()`) live on that `z`. `import { z } from 'zod'` typechecks until a
 *   route needs `.openapi()` and then fails with a missing method.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import type { ZodError } from 'zod';

export type OpenApiApp = OpenAPIHono;

export interface OpenApiAppOptions {
  /**
   * Refuse unrecognised keys. Default true — a typo that reports success is the
   * worst answer: the client believes it saved.
   */
  readonly strict?: boolean;
}

/**
 * How a failed validation reaches the caller.
 *
 * ⛔ NOT THE RAW ZodError. The default hook returns a JSON-encoded string of a JSON
 *   array, naming internal paths. A UI that reads `{ error }` cannot act on that.
 * ★ It names the field: "title: expected string" is something a person can fix.
 */
export function readableZodError(error: ZodError): string {
  const first = error.issues[0];
  if (first === undefined) return 'invalid request';
  const field = first.path.filter((part) => part !== undefined).join('.');
  // ⚠️ An unrecognised key has an EMPTY path — the key lives on the issue, not the path.
  const keys = (first as { keys?: string[] }).keys;
  if (keys !== undefined && keys.length > 0) {
    return `unknown field${keys.length > 1 ? 's' : ''}: ${keys.join(', ')}`;
  }
  return field.length > 0 ? `${field}: ${first.message}` : first.message;
}

/** One OpenAPIHono with a readable defaultHook, shared by every route. */
export function createOpenApiApp(options?: OpenApiAppOptions): OpenApiApp {
  return new OpenAPIHono({
    strict: options?.strict ?? true,
    defaultHook: (result, c) => {
      if (result.success) return undefined;
      return c.json({ error: readableZodError(result.error) }, 400);
    },
  });
}
