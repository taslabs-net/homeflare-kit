/**
 * `auth/<mount>/config` for a JWT-validating mount — the issuer, keys and algorithms a login token
 * is checked against. OPTIONAL, NON-SECRET, and deliberately unable to configure an OIDC browser
 * login: read the ⛔ in jwt-config-form.ts for why `oidc_client_secret` stays out of Alchemy.
 *
 * ⚠️ THERE IS NO DELETE. openbao v2.6.2 path_config.go:126-141 defines read and update only; the
 *   config lives exactly as long as its mount. So `delete` here writes nothing and says so in its
 *   comment — it cannot be made to "remove" a config, and refusing would wedge every destroy. The
 *   `retain` default means it only runs when a stack opted into destroy.
 *
 * ★ REPLACE SEMANTICS (REPLACE.md): `mount` changed → `replace`: the new mount gets the config;
 *   the old one keeps its own until that mount is disabled. There is no identity but the mount.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import {
  type BaoJwtAuthConfigAttributes,
  type BaoJwtAuthConfigProps,
  attributesOf,
  configPath,
  matches,
  mountOf,
  problems,
  wouldErase,
  writeBody,
} from './jwt-config-form.ts';
import { type RoleSpec, planRole, readRoleAt, reconcileRole } from './role-reconcile.ts';

export type { BaoJwtAuthConfigAttributes, BaoJwtAuthConfigProps } from './jwt-config-form.ts';

export interface BaoJwtAuthConfig extends Resource<
  'Bao.JwtAuthConfig',
  BaoJwtAuthConfigProps,
  BaoJwtAuthConfigAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoJwtAuthConfig = Resource<BaoJwtAuthConfig>('Bao.JwtAuthConfig', {
  defaultRemovalPolicy: 'retain',
});

export const jwtConfigSpec = (
  props: BaoJwtAuthConfigProps,
): RoleSpec<BaoJwtAuthConfigAttributes> => ({
  attributesOf: (live) => attributesOf(props, live),
  body: writeBody(props),
  family: 'Bao.JwtAuthConfig',
  matches: (attributes) => matches(attributes, props),
  path: configPath(props),
  problems: problems(props),
  wouldErase,
});

export const BaoJwtAuthConfigProvider = () =>
  Provider.effect(
    BaoJwtAuthConfig,
    Effect.succeed(
      BaoJwtAuthConfig.Provider.of({
        list: () => Effect.succeed([]),

        read: Effect.fn(function* ({ olds }) {
          const found = yield* readRoleAt(jwtConfigSpec(olds));
          return found?.attributes;
        }),

        diff: Effect.fn(function* ({ news, output }) {
          if (output === undefined || !isResolved(news)) return undefined;
          if (mountOf(news) !== output.mount) return { action: 'replace' } as const;
          return { action: yield* planRole(jwtConfigSpec(news)) } as const;
        }),

        /** ⛔ Refuses, before writing, a live config that carries an OIDC client (wouldErase). */
        reconcile: Effect.fn(function* ({ news }) {
          return yield* reconcileRole(jwtConfigSpec(news));
        }),

        /** ⚠️ Writes nothing — there is no delete endpoint (header). */
        delete: () => Effect.void,
      }),
    ),
  );
