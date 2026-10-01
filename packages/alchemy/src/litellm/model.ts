/**
 * `LiteLLM.Model` — one deployment row of LiteLLM's model registry (`/model/info`), an upstream
 * model the proxy's router serves under a group name. A group name can carry SEVERAL deployments
 * (that is LiteLLM's load balancing); this resource owns exactly one row.
 *
 * ★ ADOPT BY NAME. `modelName` finds the live row whose group name matches; declare `id` to pin one
 *   instead. A live row with no state is `Unowned`, so it needs `--adopt`. A name matching more
 *   than one listed row is refused, never guessed at (`LitellmModelAmbiguousNameError`).
 * ★ `defaultRemovalPolicy: 'retain'` — a deployment's removal takes it out of its routing group for
 *   every key that reaches it. Opt in with `.pipe(RemovalPolicy.destroy())`.
 * ⛔ THE CREDENTIAL IS `{ fromEnv: 'NAME' }`, NEVER A VALUE (S25): it is sent in LiteLLM's own
 *   reference form `os.environ/NAME` and the proxy resolves it in its own environment — nothing
 *   here reads `process.env` (model-credential.ts), so a value could never be sealed truthfully.
 *   A row's stored params come back DECRYPTED at v1.103.0 but with `api_key` STRIPPED (measured),
 *   so a plan compares the visible fields plus a digest of the DECLARED values (`paramsSeal`) —
 *   never the values themselves, which belong in the proxy's DB only (model-form.ts).
 * ⚠️ A RENAME IS A NEW GROUP when the id is not pinned: the old row survives under 'retain', the
 *   new group gets a fresh deterministic id. With a pinned id the SAME row is renamed — the caller
 *   chose the row (model-types.ts).
 * ⚠️ UNMEASURED AT 1.103.0, guarded by a read back: whether `/model/new` honours a supplied
 *   `model_info.id`. The answer is an untyped body, so the id ASKED FOR is the one tracked
 *   (model-operations.ts); a proxy that issued its own id fails loudly
 *   (`LitellmModelAbsentAfterWriteError`) instead of recording a row it cannot identify.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import { adoptsAtApply } from '../ownership/adopt.ts';
import { adopting } from '../ownership/adopting.ts';
import { isCreate } from '../ownership/rows.ts';
import {
  LitellmModelAbsentAfterWriteError,
  LitellmModelConfigFileRowError,
  LitellmModelForeignRowError,
  LitellmModelInvalidError,
  LitellmModelNotConvergedError,
} from './model-errors.ts';
import { createBody, declaredDigest, differing, firstProblem, patchBody } from './model-form.ts';
import { sealState } from './model-credential.ts';
import { findLive, wantedId } from './model-locate.ts';
import {
  createModel,
  deleteModel,
  listModels,
  patchModel,
  readModelRow,
} from './model-operations.ts';
import type { ModelAttributes, ModelProps } from './model-types.ts';

export type { ModelAttributes, ModelProps };
export type { ModelError } from './model-errors.ts';

export interface LiteLLMModel extends Resource<'LiteLLM.Model', ModelProps, ModelAttributes> {}

export const LiteLLMModel = Resource<LiteLLMModel>('LiteLLM.Model', {
  defaultRemovalPolicy: 'retain',
});

export const isLiteLLMModel = (value: unknown): value is LiteLLMModel =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.Model';

const refuse = (props: ModelProps) => {
  const problem = firstProblem(props);
  return problem === undefined
    ? Effect.void
    : Effect.fail(new LitellmModelInvalidError({ problem, modelName: String(props.modelName) }));
};

type Args<P> = {
  fqn: string;
  id: string;
  instanceId: string;
  output: ModelAttributes | undefined;
} & P;

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const modelHandlers = {
  /**
   * ⛔ WITH NO `output` THIS IS ALCHEMY'S ADOPTION PROBE, AND THE ONLY PLAN-TIME HOOK A NEW MODEL
   *   GETS — so the refusals run here too, as a defect (mcp-server.ts: the cold-start probe must
   *   fail the plan, and a recovery read must degrade to "nothing recovered", which only a defect
   *   does). The stored params are unreadable ciphertext, so a URL or credential value that would
   *   land in unencrypted state is refused here, before Apply commits the props.
   */
  read: ({ id, instanceId, olds, output }: Args<{ olds: ModelProps }>) =>
    Effect.gen(function* () {
      const problem = output === undefined ? firstProblem(olds) : undefined;
      if (problem !== undefined) {
        return yield* Effect.die(
          new LitellmModelInvalidError({ problem, modelName: String(olds.modelName) }),
        );
      }
      // ★ THE LIST FIRST: one GET answers a name, an id and absence (model-locate.ts).
      const found = yield* findLive(id, instanceId, olds, output);
      if (found === undefined) return undefined;
      // The row cannot supply a digest of what was declared; state can (model-form.ts).
      return output === undefined ? Unowned(found) : { ...found, paramsSeal: output.paramsSeal };
    }),

  diff: ({ news, output }: { news: Input<ModelProps>; output: ModelAttributes | undefined }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* refuse(news);
      if (output === undefined) return undefined;
      // The id is identity: a different declared id is a different row.
      if (news.id !== undefined && news.id !== output.id) {
        return { action: 'replace', deleteFirst: false } as const;
      }
      // A rename without a pinned id is a new group (model.ts header): old row retained.
      if (news.modelName !== output.modelName && news.id === undefined) {
        return { action: 'replace', deleteFirst: false } as const;
      }
      // Visible drift, or a stale seal, is an update: the read strips `api_key`, so the
      // seal is the only signal a declared credential moved (model-credential.ts).
      // Reconcile then decides the write: a bare matching adopt records its seal
      // locally, and a declaration that manages an invisible param PATCHes once to
      // converge it.
      return differing(output, news).length === 0 && sealState(news, output.paramsSeal) === 'match'
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({ fqn, id, instanceId, news, output }: Args<{ news: ModelProps }>) =>
    Effect.gen(function* () {
      yield* refuse(news);
      const before = yield* findLive(id, instanceId, news, output);
      let sealed = output?.paramsSeal ?? '';
      let modelId: string;

      if (before === undefined) {
        const wanted = yield* wantedId(id, instanceId, news, output);
        yield* createModel(createBody(news, wanted));
        // The id ASKED FOR is the one tracked; the read back refuses to claim a row the
        // proxy filed elsewhere (model.ts header's unmeasured note, model-operations.ts).
        modelId = wanted;
        sealed = declaredDigest(news);
      } else {
        // ⛔ CONFIG-FILE ROWS ARE ALWAYS REFUSED. The DB API cannot manage a row the proxy
        //   serves from its config file (`model_info.db_model: false`), regardless of whether
        //   this stack already holds state for it.
        if (before.dbModel === false) {
          return yield* Effect.fail(
            new LitellmModelConfigFileRowError({ id: before.id, modelName: news.modelName }),
          );
        }
        // ⛔ NOTHING IS WRITTEN OVER A ROW THIS STACK HOLDS NO STATE FOR, unless `--adopt`
        //   authorizes this generation (ownership/adopt.ts: a create, or an unfinished
        //   generation of our own — never a replace's new identity). A replace reconciles with
        //   no attributes and a live row under its name may belong to another deployment: only
        //   a row whose id is the one this declaration would create is ours by construction.
        //   `output` may be the live attributes the plan stripped from `Unowned(found)` (its
        //   `paramsSeal` is the empty string when no successful deploy committed a seal), so the
        //   gate runs both when output is undefined and when it is only a probe result.
        const stateless = output === undefined || output.paramsSeal === '';
        if (stateless) {
          const wanted = yield* wantedId(id, instanceId, news, output);
          // ⛔ ONLY A DETERMINISTIC ID IS OURS BY CONSTRUCTION. With no declared id, `wanted`
          //   is the physical name this declaration would create, so the one row that counts as
          //   already-existing is that exact id (a coincidence is impossible: the id carries a
          //   16-byte instance suffix). A DECLARED id is a name a human chose and could collide
          //   with a foreign row, so it always goes through the adoption gate.
          const ours = news.id === undefined && before.id === wanted;
          const isAdoption = yield* adopting({ fqn, instanceId, output }, () =>
            Effect.succeed(false),
          );
          if (!ours && !isAdoption && !(yield* adoptsAtApply({ fqn, instanceId, output }))) {
            return yield* Effect.fail(
              new LitellmModelForeignRowError({
                id: before.id,
                modelName: news.modelName,
                replace: !(yield* isCreate(fqn, instanceId)),
              }),
            );
          }
        }
        modelId = before.id;
        const drifted = differing(before, news);
        const sealStale = sealState(news, sealed) === 'stale';
        // ⛔ A STAMPING ADOPT, AND ONE MORE REASON TO WRITE. A live row starts `paramsSeal: ''`
        //   (model-form.ts), and the PATCH merge rewrites the managed `litellm_params`: a bare
        //   adopt of an already-matching row records the digest locally and writes nothing. A
        //   declaration that manages an invisible param (`apiKey` / `apiBase` — never on the
        //   read) must still write once: a matching-looking row can carry a DIFFERENT stored
        //   reference, and a local seal over it would freeze that divergence forever. A seal
        //   that EXISTS and no longer matches is a declaration this resource already owns —
        //   that one writes too, with nulls for the five non-`None` defaults (model-form.ts).
        const sealNeedsStamp =
          sealStale && (sealed !== '' || news.apiKey !== undefined || news.apiBase !== undefined);
        if (drifted.length > 0 || sealNeedsStamp) {
          yield* patchModel(patchBody(news, before));
        }
        if (drifted.length > 0 || sealStale) sealed = declaredDigest(news);
      }

      // ★ THE LIST FIRST, THEN BY ID: a row the list does not show yet (create commits, list
      //   refreshes lazily) is still a live row if the by-id read answers it.
      const after =
        (yield* listModels()).find((row) => row.id === modelId) ?? (yield* readModelRow(modelId));
      if (after === undefined) {
        return yield* Effect.fail(
          new LitellmModelAbsentAfterWriteError({ id: modelId, modelName: news.modelName }),
        );
      }
      const left = differing(after, news);
      if (left.length > 0) {
        return yield* Effect.fail(
          new LitellmModelNotConvergedError({
            fields: left,
            id: modelId,
            modelName: news.modelName,
          }),
        );
      }
      return { ...after, paramsSeal: sealed };
    }),

  delete: ({ output }: { output: ModelAttributes }) => deleteModel(output.id),

  /** ⛔ EMPTY: adoption is an explicit act (`--adopt`), and no ownership mark exists to filter by. */
  list: () => Effect.succeed([]),
};

export const LiteLLMModelProvider = () =>
  Provider.effect(LiteLLMModel, Effect.succeed(LiteLLMModel.Provider.of(modelHandlers)));
