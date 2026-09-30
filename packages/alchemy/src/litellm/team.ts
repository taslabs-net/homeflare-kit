/**
 * `LiteLLM.Team` — one row of LiteLLM's team table (`/team/*`): the models, MCP grants and roster that
 * bound every key of a team. Props, the MCP ceiling and everything left out: team-types.ts.
 *
 * ★ ADOPT BY ID. `teamId` names the live team; without it a deterministic physical name is used. A
 *   team with that id and no state is `Unowned`, so it needs `--adopt`. (`team_alias` is not unique, so
 *   it cannot identify a team.)
 * ★ `defaultRemovalPolicy: 'retain'` — deleting a team DELETES EVERY KEY OF THE TEAM (team-operations.ts).
 *   Opt in with `.pipe(RemovalPolicy.destroy())`, knowing that.
 * ★ A DECLARED FIELD IS THE TRUTH, AN UNDECLARED ONE IS LEFT ALONE. `models`, `blocked`,
 *   `accessGroupIds`, each object-permission field and the roster are compared and sent only when
 *   declared; the update is a partial one, and the object permission a merge by field (team-permission.ts),
 *   so an adopted team keeps everything this resource does not manage.
 * ⛔ THE ROSTER IS ADDITIVE ONLY (team-members.ts): removing a member would delete that user's keys.
 * ⚠️ NO LICENCE GATE ON THE FIELDS IT MANAGES except a member's `admin` role (Enterprise, 400 without a
 *   licence: `team_endpoints.py` lines 2713-2723, 3806-3810). Every other Enterprise team field is one
 *   this resource never sends (team-types.ts lists them).
 * ⛔ NO LITELLM CREDENTIAL IS A PROP; `litellmProviders`' layer supplies `Credentials`.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { createPhysicalName } from 'alchemy/PhysicalName';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import {
  LitellmRegistryAbsentAfterWriteError,
  LitellmRegistryNotConvergedError,
} from './registry-errors.ts';
import { dieIfInvalid, failIfInvalid } from './registry-support.ts';
import { createBody, differing, firstProblem, updateBody } from './team-form.ts';
import { membersToAdd, roleChanges } from './team-members.ts';
import {
  addMembers,
  createTeam,
  deleteTeam,
  readTeam,
  setMemberRole,
  updateTeam,
} from './team-operations.ts';
import type { TeamAttributes, TeamProps } from './team-types.ts';

export type { TeamAttributes, TeamProps };
export type {
  TeamMember,
  TeamMemberAttributes,
  TeamObjectPermission,
  TeamObjectPermissionAttributes,
} from './team-types.ts';
export type { RegistryError as TeamError } from './registry-errors.ts';

const RESOURCE = 'LiteLLM.Team';

export interface LiteLLMTeam extends Resource<'LiteLLM.Team', TeamProps, TeamAttributes> {}

export const LiteLLMTeam = Resource<LiteLLMTeam>('LiteLLM.Team', {
  defaultRemovalPolicy: 'retain',
});

export const isLiteLLMTeam = (value: unknown): value is LiteLLMTeam =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.Team';

/** The team id: the recorded one, else the declared one, else a deterministic physical name. */
const idOf = (
  id: string,
  instanceId: string,
  props: TeamProps,
  output: TeamAttributes | undefined,
) =>
  output?.teamId !== undefined
    ? Effect.succeed(output.teamId)
    : props.teamId !== undefined
      ? Effect.succeed(props.teamId)
      : createPhysicalName({ id, instanceId, lowercase: true, maxLength: 64 });

type Args<P> = { id: string; instanceId: string; output: TeamAttributes | undefined } & P;

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const teamHandlers = {
  /** ⛔ With no `output` this is the adoption probe, so the refusals run here too (registry-support.ts). */
  read: ({ id, instanceId, olds, output }: Args<{ olds: TeamProps }>) =>
    Effect.gen(function* () {
      if (output === undefined) {
        yield* dieIfInvalid(RESOURCE, String(olds.teamAlias), firstProblem(olds));
      }
      const live = yield* readTeam(yield* idOf(id, instanceId, olds, output));
      if (live === undefined) return undefined;
      return output === undefined ? Unowned(live) : live;
    }),

  diff: ({ news, output }: { news: Input<TeamProps>; output: TeamAttributes | undefined }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* failIfInvalid(RESOURCE, String(news.teamAlias), firstProblem(news));
      if (output === undefined) return undefined;
      // The id is identity: a different declared id is a different team.
      if (news.teamId !== undefined && news.teamId !== output.teamId) {
        return { action: 'replace', deleteFirst: false } as const;
      }
      return differing(output, news).length === 0
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({ id, instanceId, news, output }: Args<{ news: TeamProps }>) =>
    Effect.gen(function* () {
      yield* failIfInvalid(RESOURCE, String(news.teamAlias), firstProblem(news));
      const teamId = yield* idOf(id, instanceId, news, output);
      const before = yield* readTeam(teamId);
      if (before === undefined) yield* createTeam(createBody(news, teamId));
      else {
        const body = updateBody(news, before);
        if (body !== undefined) yield* updateTeam(body);
      }

      // The roster, additively (team-members.ts). Read after the team write so a fresh team is seen.
      if (news.members !== undefined) {
        const live = yield* readTeam(teamId);
        if (live === undefined) {
          return yield* Effect.fail(
            new LitellmRegistryAbsentAfterWriteError({ name: news.teamAlias, resource: RESOURCE }),
          );
        }
        const missing = membersToAdd(live.members, news.members);
        if (missing.length > 0) yield* addMembers(teamId, missing);
        for (const member of roleChanges(live.members, news.members)) {
          yield* setMemberRole(teamId, member);
        }
      }

      const after = yield* readTeam(teamId);
      if (after === undefined) {
        return yield* Effect.fail(
          new LitellmRegistryAbsentAfterWriteError({ name: news.teamAlias, resource: RESOURCE }),
        );
      }
      const left = differing(after, news);
      if (left.length > 0) {
        return yield* Effect.fail(
          new LitellmRegistryNotConvergedError({
            fields: left,
            name: news.teamAlias,
            resource: RESOURCE,
          }),
        );
      }
      return after;
    }),

  delete: ({ output }: { output: TeamAttributes }) => deleteTeam(output.teamId),

  /** ⛔ EMPTY: adoption is an explicit act (`--adopt`), and no ownership mark exists to filter by. */
  list: () => Effect.succeed([]),
};

export const LiteLLMTeamProvider = () =>
  Provider.effect(LiteLLMTeam, Effect.succeed(LiteLLMTeam.Provider.of(teamHandlers)));
