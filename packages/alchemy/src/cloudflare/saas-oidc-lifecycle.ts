/**
 * read / reconcile / delete for `HomeFlare.Access.SaasOidcApplication`, as plain Effects over the
 * calls in saas-oidc-api.ts. saas-oidc.ts only wires them into Alchemy.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { createPhysicalName } from 'alchemy/PhysicalName';
import * as Effect from 'effect/Effect';
import {
  SaasOidcError,
  createApp,
  deleteApp,
  findSaasByName,
  getApp,
  updateApp,
} from './saas-oidc-api.ts';
import {
  type SaasOidcApplicationAttributes,
  type SaasOidcApplicationProps,
  checkTeam,
  needsSync,
  toAttributes,
  validateSaasOidc,
  writeBody,
} from './saas-oidc-form.ts';
import type { ObservedApp } from './saas-oidc-wire.ts';

const resolveName = (id: string, name: string | undefined) =>
  name !== undefined && name !== '' ? Effect.succeed(name) : createPhysicalName({ id });

/**
 * The live app: by the known id when there is one, else by exact name. A saas app found by id that
 * is NOT type `saas` is refused, never rewritten: `applicationId` pointing at a self-hosted app
 * would otherwise have its type overwritten by the update.
 */
const observe = (accountId: string, knownId: string | undefined, name: string) =>
  Effect.gen(function* () {
    const byId = knownId === undefined ? undefined : yield* getApp(accountId, knownId);
    if (byId !== undefined) {
      if (byId.type !== 'saas') {
        return yield* Effect.fail(
          new SaasOidcError({
            message: `Access application ${knownId} is type "${byId.type ?? 'unknown'}", not "saas". Refusing to rewrite it as a SaaS OIDC app.`,
          }),
        );
      }
      return byId;
    }
    const foundId = yield* findSaasByName(accountId, name);
    return foundId === undefined ? undefined : yield* getApp(accountId, foundId);
  });

/**
 * Owned: refresh by the stored id. Cold: find the app by `applicationId` or exact name and hand it
 * back `Unowned`, so Alchemy refuses to take it over until the stack says `adopt(true)`.
 * ★ `olds` MAY PREDATE `teamDomain` (state written by the openbao copy of this resource): the host
 *   Cloudflare reports for the app stands in, so the first plan after the move can still read.
 */
export const readSaasOidc = (
  accountId: string,
  id: string,
  olds: SaasOidcApplicationProps | undefined,
  output: SaasOidcApplicationAttributes | undefined,
) =>
  Effect.gen(function* () {
    const name = yield* resolveName(id, output?.name ?? olds?.name);
    const observed = yield* observe(accountId, output?.applicationId ?? olds?.applicationId, name);
    if (observed === undefined) return undefined;
    const attributes = toAttributes(
      observed,
      output?.accountId ?? accountId,
      name,
      output?.teamDomain ?? olds?.teamDomain,
    );
    if (attributes === undefined) return undefined;
    return output?.applicationId !== undefined ? attributes : Unowned(attributes);
  });

const missing = (what: string) =>
  Effect.fail(
    new SaasOidcError({
      message: `SaaS OIDC ${what} succeeded but the GET did not return the app.`,
    }),
  );

/** observe, ensure (create or sync), read back. A no-op when nothing drifted. */
export const reconcileSaasOidc = (
  accountId: string,
  id: string,
  news: SaasOidcApplicationProps,
  output: SaasOidcApplicationAttributes | undefined,
) =>
  Effect.gen(function* () {
    const invalid = validateSaasOidc(news);
    if (invalid !== undefined) return yield* Effect.fail(invalid);
    const name = yield* resolveName(id, news.name);
    let observed: ObservedApp | undefined = yield* observe(
      accountId,
      output?.applicationId ?? news.applicationId,
      name,
    );
    // ⛔ BEFORE ANY WRITE: a wrong team domain must not cost an update to the wrong app.
    const wrongTeam = observed === undefined ? undefined : checkTeam(news.teamDomain, observed);
    if (wrongTeam !== undefined) return yield* Effect.fail(wrongTeam);
    const write = writeBody(news, name);
    if (observed === undefined) {
      const createdId = yield* createApp(accountId, write);
      observed = yield* getApp(accountId, createdId);
      if (observed === undefined) return yield* missing('create');
    } else if (needsSync(news, observed, name)) {
      const appId = observed.id;
      if (appId === undefined) {
        return yield* Effect.fail(new SaasOidcError({ message: 'SaaS OIDC app has no id.' }));
      }
      yield* updateApp(accountId, appId, write);
      observed = yield* getApp(accountId, appId);
      if (observed === undefined) return yield* missing('update');
    }
    const teamAfterWrite = checkTeam(news.teamDomain, observed);
    if (teamAfterWrite !== undefined) return yield* Effect.fail(teamAfterWrite);
    const attributes = toAttributes(observed, accountId, name, news.teamDomain);
    if (attributes === undefined) {
      return yield* Effect.fail(
        new SaasOidcError({
          message: 'Cloudflare returned a SaaS OIDC application without an id, aud or client id.',
        }),
      );
    }
    return attributes;
  });

export const deleteSaasOidc = (output: SaasOidcApplicationAttributes) =>
  deleteApp(output.accountId, output.applicationId);
