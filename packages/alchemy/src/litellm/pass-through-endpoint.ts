/**
 * `LiteLLM.PassThroughEndpoint` — one row in LiteLLM's `general_settings.pass_through_endpoints`.
 *
 * ★ ADOPT-FRIENDLY BY id, NOT BY PATH. `output?.id` is used as the object's live id once the
 *   engine has one — from our own prior create (the deterministic physical name) or from an
 *   adopted foreign row — and `read` computes a FRESH physical name only for a resource the
 *   engine has never resolved before. This is S7/S9's "output is a cache of stable identifiers,
 *   not proof the object exists" and S13's "an adopted object keeps its live name as an explicit
 *   prop", applied to an id LiteLLM lets a client choose (`_types.py:2192` at v1.100.0: create
 *   takes a caller-supplied `id`, else `uuid4()`).
 *
 * ⛔ A PATH HELD BY AN `is_from_config` ROW IS REFUSED, NOT ADOPTED. A DB row on the same path
 *   overrides it at runtime (`pass_through_endpoints.py` merges DB after config, at the tag) — so
 *   creating one would silently take over a route the operator declared in `config.yaml`, the
 *   exact "DB row silently overrides the file" the task names. `is_from_config` rows are also
 *   never updated or deleted by this provider, for the same reason.
 * ⛔ A DB ROW WITH NO `id` (path-only, `_types.py`'s "backwards compatibility" case) CANNOT BE
 *   ADDRESSED by the id-keyed update/delete calls this provider uses, so it is refused rather than
 *   silently adopted into an id-based lifecycle it cannot actually manage — see docs/litellm.md.
 * ⛔ NO CREDENTIAL IS A PROP (S25). `LITELLM_PROXY_URL`/`LITELLM_PROXY_API_KEY` are read at call
 *   time by credentials.ts.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { createPhysicalName } from 'alchemy/PhysicalName';
import * as Provider from 'alchemy/Provider';
import type { Stack } from 'alchemy/Stack';
import type { Stage } from 'alchemy/Stage';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import {
  type LitellmError,
  type LitellmRequirements,
  createPassThroughEndpoint,
  deletePassThroughEndpoint,
  listPassThroughEndpoints,
  updatePassThroughEndpoint,
} from './client.ts';
import type { PassThroughGenericEndpoint } from './generated/pass-through.ts';
import {
  type PassThroughEndpointAttributes,
  type PassThroughEndpointProps,
  createBody,
  literalSecretHeaders,
  matches,
  needsReplace,
  updateBody,
} from './pass-through-form.ts';

export type { PassThroughEndpointAttributes, PassThroughEndpointProps };

export class LitellmConfigPathConflictError extends Data.TaggedError(
  'LitellmConfigPathConflictError',
)<{
  readonly path: string;
}> {}
export class LitellmUnaddressableRowError extends Data.TaggedError('LitellmUnaddressableRowError')<{
  readonly path: string;
}> {}
export class LitellmLiteralSecretHeaderError extends Data.TaggedError(
  'LitellmLiteralSecretHeaderError',
)<{
  readonly headers: readonly string[];
}> {}

export type PassThroughEndpointError =
  | LitellmError
  | LitellmConfigPathConflictError
  | LitellmUnaddressableRowError
  | LitellmLiteralSecretHeaderError;

export interface LiteLLMPassThroughEndpoint extends Resource<
  'LiteLLM.PassThroughEndpoint',
  PassThroughEndpointProps,
  PassThroughEndpointAttributes,
  never,
  LitellmRequirements | Stack | Stage
> {}

export const LiteLLMPassThroughEndpoint = Resource<LiteLLMPassThroughEndpoint>(
  'LiteLLM.PassThroughEndpoint',
);

export const isLiteLLMPassThroughEndpoint = (value: unknown): value is LiteLLMPassThroughEndpoint =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.PassThroughEndpoint';

const toAttributes = (
  row: PassThroughGenericEndpoint,
  fallbackId: string,
): PassThroughEndpointAttributes => ({
  ...row,
  id: row.id ?? fallbackId,
});

const physicalIdOf = (logicalId: string, instanceId: string) =>
  createPhysicalName({ id: logicalId, instanceId, lowercase: true, maxLength: 64 });

/**
 * Find this resource's live row (by id) and, when absent, the row that already holds its `path`
 * (a config-file row to refuse, or a DB row LiteLLM did not give an id — also refused, see the
 * file header — or a genuine foreign DB row to hand back `Unowned`).
 */
const locate = (
  rows: readonly PassThroughGenericEndpoint[],
  objectId: string,
  path: string,
): {
  readonly mine: PassThroughGenericEndpoint | undefined;
  readonly conflict: PassThroughGenericEndpoint | undefined;
} => {
  const mine = rows.find((row) => row.id === objectId);
  const conflict = mine === undefined ? rows.find((row) => row.path === path) : undefined;
  return { conflict, mine };
};

/** The typed refusal for a `path` conflict that cannot ever be adopted (config row, or no id). */
const conflictRefusal = (conflict: PassThroughGenericEndpoint, path: string) =>
  conflict.is_from_config === true
    ? new LitellmConfigPathConflictError({ path })
    : new LitellmUnaddressableRowError({ path });

/** `read`'s answer for a path conflict: `Unowned` when it is a real, addressable DB row — a typed refusal otherwise. */
const readConflict = (conflict: PassThroughGenericEndpoint, path: string) =>
  conflict.is_from_config !== true && conflict.id !== undefined && conflict.id !== null
    ? Effect.succeed(Unowned(toAttributes(conflict, conflict.id)))
    : Effect.fail(conflictRefusal(conflict, path));

const refuseLiteralSecrets = (headers: Readonly<Record<string, unknown>> | undefined) => {
  const bad = literalSecretHeaders(headers);
  return bad.length === 0
    ? Effect.void
    : Effect.fail(new LitellmLiteralSecretHeaderError({ headers: bad }));
};

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel — a lifecycle test calls these directly against the fake. */
export const passThroughHandlers = {
  read: ({
    id,
    instanceId,
    olds,
    output,
  }: {
    id: string;
    instanceId: string;
    olds: PassThroughEndpointProps;
    output: PassThroughEndpointAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      const objectId = output?.id ?? (yield* physicalIdOf(id, instanceId));
      const rows = yield* listPassThroughEndpoints();
      const { conflict, mine } = locate(rows, objectId, olds.path);
      if (mine !== undefined) return toAttributes(mine, objectId);
      if (conflict === undefined) return undefined;
      return yield* readConflict(conflict, olds.path);
    }),

  diff: ({
    news,
    output,
  }: {
    news: Input<PassThroughEndpointProps>;
    output: PassThroughEndpointAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* refuseLiteralSecrets(news.headers);
      if (output === undefined) return undefined;
      // ⛔ deleteFirst: TRUE — a create-first replace mints a new instanceId/id before the old row
      //   on `path` is gone, so the new generation's `reconcile` would refuse it as a foreign
      //   conflict (Apply.ts). Same fix this kit's other unique-identity providers use.
      if (needsReplace(output, news)) return { action: 'replace', deleteFirst: true } as const;
      return matches(output, news)
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({
    id,
    instanceId,
    news,
    output,
  }: {
    id: string;
    instanceId: string;
    news: PassThroughEndpointProps;
    output: PassThroughEndpointAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      yield* refuseLiteralSecrets(news.headers);
      const objectId = output?.id ?? (yield* physicalIdOf(id, instanceId));
      const rows = yield* listPassThroughEndpoints();
      const { conflict, mine } = locate(rows, objectId, news.path);

      if (mine === undefined) {
        // ⚠️ A CONFLICT HERE — reconcile, not read — means ownership shifted between plan and
        //   apply (a config row or a foreign DB row landed on this path after `read` cleared it).
        //   `read` gates a genuine adopt by returning `Unowned`; reconcile itself never adopts,
        //   so ANY conflict here fails rather than risking a second row on one path.
        if (conflict !== undefined) return yield* Effect.fail(conflictRefusal(conflict, news.path));
        yield* createPassThroughEndpoint(createBody(news, objectId));
      } else if (mine.is_from_config === true) {
        // ⛔ NEVER UPDATE OR DELETE AN `is_from_config` ROW, even one this resource's own
        //   deterministic id happens to match (a config.yaml author could in principle choose the
        //   same id `createPhysicalName` would). Refuse rather than silently editing the file's row.
        return yield* Effect.fail(new LitellmConfigPathConflictError({ path: news.path }));
      } else if (needsReplace(toAttributes(mine, objectId), news)) {
        yield* deletePassThroughEndpoint(objectId);
        yield* createPassThroughEndpoint(createBody(news, objectId));
      } else if (!matches(toAttributes(mine, objectId), news)) {
        const body = updateBody(news);
        if (Object.keys(body).length > 0) yield* updatePassThroughEndpoint(objectId, body);
      }

      const after = (yield* listPassThroughEndpoints()).find((row) => row.id === objectId);
      if (after === undefined) {
        return yield* Effect.die(
          new Error(
            `LiteLLM.PassThroughEndpoint ${news.path}: the write returned no error but id ` +
              `${objectId} is still absent from GET /config/pass_through_endpoint — read back ` +
              'rather than trusting the call that just returned.',
          ),
        );
      }
      return toAttributes(after, objectId);
    }),

  delete: ({
    id,
    instanceId,
    olds,
    output,
  }: {
    id: string;
    instanceId: string;
    olds: PassThroughEndpointProps;
    output: PassThroughEndpointAttributes;
  }) =>
    Effect.gen(function* () {
      const objectId = output.id ?? (yield* physicalIdOf(id, instanceId));
      const rows = yield* listPassThroughEndpoints();
      const live = rows.find((row) => row.id === objectId);
      // ⛔ NEVER DELETE AN `is_from_config` ROW, and a DB row this resource never created (a path
      //   match with a different id) is not this resource's to remove either.
      if (live === undefined || live.is_from_config === true || live.path !== olds.path) return;
      yield* deletePassThroughEndpoint(objectId);
    }),

  list: () => Effect.succeed([]),
};

export const LiteLLMPassThroughEndpointProvider = () =>
  Provider.effect(
    LiteLLMPassThroughEndpoint,
    Effect.succeed(LiteLLMPassThroughEndpoint.Provider.of(passThroughHandlers)),
  );
