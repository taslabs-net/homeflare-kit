/**
 * `LiteLLM.MCPServer` — one row of LiteLLM's `LiteLLM_MCPServerTable` (`/v1/mcp/server`), an
 * upstream MCP server the proxy's gateway exposes to keys and teams.
 *
 * ★ ADOPT BY NAME. `serverName` finds the live row whose `server_name` matches; declare `serverId`
 *   to pin one instead. A live row with no state is `Unowned`, so it needs `--adopt`. Two rows with
 *   the same name are refused, never guessed at (`LitellmMcpServerAmbiguousNameError`).
 * ★ `defaultRemovalPolicy: 'retain'` — a server's removal takes its tools from every key, team and
 *   seat that reaches it. Opt in with `.pipe(RemovalPolicy.destroy())`.
 * ⛔ THE CREDENTIAL IS `{ fromEnv: 'NAME' }`, NEVER A VALUE (S25): mcp-server-types.ts says why a
 *   `Redacted` prop would still be stored in plaintext. Reading a server never reveals auth material
 *   either — `toAttributes` copies no credential — and a rotated credential is noticed through a
 *   seal (mcp-server-credential.ts).
 * ⛔ NO LITELLM CREDENTIAL IS A PROP either: `litellmProviders`' layer supplies `Credentials`.
 * ⚠️ UNMEASURED AT 1.103.0, each guarded by a read back: whether `PUT /v1/mcp/server` merges or
 *   replaces, whether a create honours a supplied `server_id`, and whether an empty list or a
 *   `false` lands on an edit. Nothing here assumes them; the returned row is what is recorded.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { createPhysicalName } from 'alchemy/PhysicalName';
import * as Provider from 'alchemy/Provider';
import type * as mcp from '@distilled.cloud/litellm/mcp_management';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import {
  LitellmMcpServerAbsentAfterWriteError,
  LitellmMcpServerAmbiguousNameError,
  LitellmMcpServerCredentialEnvUnsetError,
  LitellmMcpServerInvalidError,
  LitellmMcpServerNotConvergedError,
} from './mcp-server-errors.ts';
import { credentialState, resolveCredential, sealCredential } from './mcp-server-credential.ts';
import {
  createBody,
  differing,
  firstProblem,
  toAttributes,
  updateBody,
} from './mcp-server-form.ts';
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  updateMcpServer,
} from './mcp-server-operations.ts';
import {
  type McpServerAttributes,
  type McpServerProps,
  isStaticAuthType,
} from './mcp-server-types.ts';

export type { McpServerAttributes, McpServerProps };
export type { McpServerError } from './mcp-server-errors.ts';

export interface LiteLLMMCPServer extends Resource<
  'LiteLLM.MCPServer',
  McpServerProps,
  McpServerAttributes
> {}

export const LiteLLMMCPServer = Resource<LiteLLMMCPServer>('LiteLLM.MCPServer', {
  defaultRemovalPolicy: 'retain',
});

export const isLiteLLMMCPServer = (value: unknown): value is LiteLLMMCPServer =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.MCPServer';

const refuse = (props: McpServerProps) => {
  const problem = firstProblem(props);
  return problem === undefined
    ? Effect.void
    : Effect.fail(
        new LitellmMcpServerInvalidError({ problem, serverName: String(props.serverName) }),
      );
};

/**
 * The live row this declaration means, or `undefined`. A pinned id (from state, else declared) wins;
 * otherwise the name decides, and an ambiguous name is refused.
 */
const locate = (
  rows: readonly mcp.LiteLLMMCPServerTable[],
  props: McpServerProps,
  output: McpServerAttributes | undefined,
) => {
  const pinned = output?.serverId ?? props.serverId;
  if (pinned !== undefined) return Effect.succeed(rows.find((row) => row.server_id === pinned));
  const named = rows.filter((row) => row.server_name === props.serverName);
  return named.length > 1
    ? Effect.fail(
        new LitellmMcpServerAmbiguousNameError({
          serverIds: named.map((row) => row.server_id),
          serverName: props.serverName,
        }),
      )
    : Effect.succeed(named[0]);
};

const wantedId = (
  id: string,
  instanceId: string,
  props: McpServerProps,
  output: McpServerAttributes | undefined,
) =>
  output?.serverId !== undefined
    ? Effect.succeed(output.serverId)
    : props.serverId !== undefined
      ? Effect.succeed(props.serverId)
      : createPhysicalName({ id, instanceId, lowercase: true, maxLength: 64 });

type Args<P> = {
  id: string;
  instanceId: string;
  output: McpServerAttributes | undefined;
} & P;

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const mcpServerHandlers = {
  /**
   * ⛔ WITH NO `output` THIS IS ALCHEMY'S ADOPTION PROBE, AND THE ONLY PLAN-TIME HOOK A NEW SERVER
   *   GETS — so the refusals run here too. Measured on beta.79 (`Plan.ts` lines 1303-1316, the
   *   `oldState === undefined` branch): a declaration with no state row is `read` with `olds: news`
   *   and never `diff`ed, and Apply then commits its props as `creating` BEFORE `reconcile` runs. A
   *   URL that carries a token would already be in the unencrypted store when reconcile refused it.
   * ★ A DEFECT (`Effect.die`), NOT A TYPED FAILURE, and that is what keeps it from wedging a stage:
   *   the same call shape is Alchemy's recovery read of an interrupted create (`Plan.ts` lines
   *   1428-1447), with the STORED props, and only a defect is caught there (`Effect.catchDefect`
   *   degrades it to "nothing recovered"). A typed failure would block the plan on props that a
   *   later, stricter release now refuses. The cold-start probe has no such catch, so there the
   *   defect fails the plan, as intended. `pbs-notification-target-lifecycle.ts` reasons the same.
   */
  read: ({ olds, output }: Args<{ olds: McpServerProps }>) =>
    Effect.gen(function* () {
      const problem = output === undefined ? firstProblem(olds) : undefined;
      if (problem !== undefined) {
        return yield* Effect.die(
          new LitellmMcpServerInvalidError({ problem, serverName: String(olds.serverName) }),
        );
      }
      const found = yield* locate(yield* listMcpServers(), olds, output);
      if (found === undefined) return undefined;
      const live = toAttributes(found);
      return output === undefined
        ? Unowned(live)
        : { ...live, credentialSeal: output.credentialSeal };
    }),

  diff: ({
    news,
    output,
  }: {
    news: Input<McpServerProps>;
    output: McpServerAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* refuse(news);
      if (output === undefined) return undefined;
      // The id is identity: a different declared id is a different row.
      if (news.serverId !== undefined && news.serverId !== output.serverId) {
        return { action: 'replace', deleteFirst: false } as const;
      }
      return differing(output, news).length === 0 &&
        credentialState(news, output.credentialSeal) !== 'stale'
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({ id, instanceId, news, output }: Args<{ news: McpServerProps }>) =>
    Effect.gen(function* () {
      yield* refuse(news);
      const before = yield* locate(yield* listMcpServers(), news, output);
      const credential = resolveCredential(news);
      let sealed = output?.credentialSeal ?? '';
      let serverId: string;

      if (before === undefined) {
        // A static credential is part of the create: without it the row would exist unusable.
        if (isStaticAuthType(news.authType) && credential.value === undefined) {
          return yield* Effect.fail(
            new LitellmMcpServerCredentialEnvUnsetError({
              serverName: news.serverName,
              variable: credential.variable ?? '(undeclared)',
            }),
          );
        }
        const wanted = yield* wantedId(id, instanceId, news, output);
        const created = yield* createMcpServer(createBody(news, wanted, credential.value));
        // ★ THE ROW LITELLM ANSWERS IS THE TRUTH: a proxy that ignores a supplied `server_id` is
        //   recorded under the id it actually used, not the one that was asked for.
        serverId = typeof created?.server_id === 'string' ? created.server_id : wanted;
        sealed = credential.value === undefined ? '' : sealCredential(credential.value);
      } else {
        serverId = before.server_id;
        const live = toAttributes(before);
        const state = credentialState(news, sealed, credential);
        if (differing(live, news).length > 0 || state === 'stale') {
          // ★ Sent whenever the deploying process has it, demanded only when the seal says stale.
          const send = isStaticAuthType(news.authType) ? credential.value : undefined;
          const leavingStatic =
            !isStaticAuthType(news.authType) && (sealed !== '' || isStaticAuthType(live.authType));
          yield* updateMcpServer(updateBody(news, serverId, send, leavingStatic));
          if (send !== undefined) sealed = sealCredential(send);
          else if (leavingStatic) sealed = '';
        }
      }

      const found = (yield* listMcpServers()).find((row) => row.server_id === serverId);
      if (found === undefined) {
        return yield* Effect.fail(
          new LitellmMcpServerAbsentAfterWriteError({ serverId, serverName: news.serverName }),
        );
      }
      const after = toAttributes(found);
      const left = differing(after, news);
      if (left.length > 0) {
        return yield* Effect.fail(
          new LitellmMcpServerNotConvergedError({
            fields: left,
            serverId,
            serverName: news.serverName,
          }),
        );
      }
      return { ...after, credentialSeal: sealed };
    }),

  delete: ({ output }: { output: McpServerAttributes }) => deleteMcpServer(output.serverId),

  /** ⛔ EMPTY: adoption is an explicit act (`--adopt`), and no ownership mark exists to filter by. */
  list: () => Effect.succeed([]),
};

export const LiteLLMMCPServerProvider = () =>
  Provider.effect(
    LiteLLMMCPServer,
    Effect.succeed(LiteLLMMCPServer.Provider.of(mcpServerHandlers)),
  );
