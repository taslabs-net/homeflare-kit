/**
 * Small pure helpers the LiteLLM registry resources share (`LiteLLM.Team`, `AccessGroup`,
 * `Toolset`, `Policy`, `PolicyAttachment`, `ToolPolicy`). Nothing here talks to a proxy.
 *
 * ★ WHY ONE FILE AND NOT ONE COPY PER RESOURCE: every one of these answers the same three
 *   questions about a `body: unknown` reply — "what is the payload", "is this list a set of rows",
 *   "is this failure a missing row" — and they must answer them the same way, or two resources
 *   disagree about what absence looks like.
 * ⛔ NO MESSAGE OR STATUS SNIFFING (S21). `isNotFound` is a CLASS test against the SDK's own
 *   `NotFound`, never a `.status` or message match. These routes do not DECLARE 404 (only the
 *   `team_management` create/update/delete routes do, by distilled patch), but core's shared status
 *   map still decodes a 404 to that class at run time, invisible to the type checker
 *   (`mcp-server-operations.ts` says the same about its own by-id read). The typed fix is a distilled
 *   patch for each tag, which belongs in the distilled clone — never a catch by text here.
 * ⚠️ WHICH CLASS A 404 DECODES TO DEPENDS ON THE TAG. Where the SDK DECLARES the status (a distilled
 *   patch: the `team_management` create, update and delete routes), the runtime error is that service
 *   module's OWN `NotFound`, a different class from the core one exported by `Errors`, and only
 *   `Effect.catchTag('NotFound')` sees it (`deleteTeam`). Where it is undeclared (`/team/info`,
 *   toolset and tool reads) it is core's, and this `instanceof` sees it. A later patch that declares
 *   404 for one of those tags would move it to the other class and fail the tests here, which run every
 *   call through the real SDK decode, rather than silently reading "not found" as a failure.
 */
import { NotFound } from '@distilled.cloud/litellm/Errors';
import * as Effect from 'effect/Effect';
import { LitellmRegistryInvalidError } from './registry-errors.ts';

/** Whether a failure is the SDK's `NotFound` class. A 401, a 500 or a dead network is never absence. */
export const isNotFound = (error: unknown): boolean => error instanceof NotFound;

/**
 * ⚠️ The SDK types most of these answers `{ body: unknown }`, but hands a JSON array or object back as
 *   it came (measured through the fakes, as for `/budget/list`). Accept both shapes.
 */
export const bodyOf = (response: unknown): unknown =>
  typeof response === 'object' &&
  response !== null &&
  !Array.isArray(response) &&
  'body' in response
    ? (response as { readonly body: unknown }).body
    : response;

export type Row = Readonly<Record<string, unknown>>;

/** The value as a plain object, else `undefined`. An array is not a row. */
export const asRow = (value: unknown): Row | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : undefined;

/** The strings of a live list, in order. Anything else (`null`, a number) is skipped, never trusted. */
export const stringsOf = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];

/** `null` for anything that is not a string: a live column can hold `null`, and so can a proxy's JSON. */
export const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/** `null` for anything that is not a finite number. Numeric strings (Prisma BigInt) are converted. */
export const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Sorted, de-duplicated. Every list a resource compares is a SET, so this is its canonical form. */
export const canonical = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort();

export const sameSet = (left: readonly string[], right: readonly string[]): boolean => {
  const a = canonical(left);
  const b = canonical(right);
  return a.length === b.length && a.every((each, index) => each === b[index]);
};

/** Whether a value is not a string with something in it. Takes `unknown`: a declaration can say anything. */
export const isBlank = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '';

/** The first blank or padded entry of a declared list, or `undefined`. Padding is refused too: it is a typo. */
export const firstBadEntry = (values: readonly unknown[]): string | undefined => {
  for (const each of values) {
    if (isBlank(each) || (each as string) !== (each as string).trim()) return String(each);
  }
  return undefined;
};

/** A list that names one entry twice. Refused rather than silently collapsed: the twin is a typo. */
export const firstDuplicate = (values: readonly string[]): string | undefined =>
  values.find((each, index) => values.indexOf(each) !== index);

/**
 * A refusal as a TYPED FAILURE. Used in `diff` and `reconcile`, where a failure blocks that one
 * resource with a message.
 */
export const failIfInvalid = (resource: string, name: string, problem: string | undefined) =>
  problem === undefined
    ? Effect.void
    : Effect.fail(new LitellmRegistryInvalidError({ name, problem, resource }));

/**
 * The same refusal as a DEFECT, for `read` with no `output` — Alchemy's adoption probe and the ONLY
 * plan-time hook a brand-new declaration gets (`mcp-server.ts` measured this on beta.79, `Plan.ts`
 * lines 1303-1316). ★ A defect and not a typed failure because the same call shape is Alchemy's
 * recovery read of an interrupted create with the STORED props, where only a defect is caught
 * (`Effect.catchDefect`); a typed failure would wedge a stage on props a later, stricter release now
 * refuses. The cold-start probe has no such catch, so there the defect fails the plan, as intended.
 */
export const dieIfInvalid = (resource: string, name: string, problem: string | undefined) =>
  problem === undefined
    ? Effect.void
    : Effect.die(new LitellmRegistryInvalidError({ name, problem, resource }));
