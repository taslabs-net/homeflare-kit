/**
 * The team-domain check that runs BEFORE a first create, so a wrong `teamDomain` is refused with no
 * write instead of after one (saas-oidc-lifecycle.ts says where it is called).
 *
 * ★ THE ACCOUNT'S TEAM DOMAIN CAN BE READ BEFORE ANY APP EXISTS: `GET /accounts/{account_id}/access/
 *   organizations` returns the Zero Trust organization, whose `auth_domain` is "The unique subdomain
 *   assigned to your Zero Trust organization" (`@distilled.cloud/cloudflare@1.0.0-rc.13`
 *   `listOrganizationsForAccount`, zero_trust.ts:168990 for the path and :238313-238324 for the
 *   operation; `ListOrganizationsResponse.authDomain`, :169161). Alchemy's own
 *   `Cloudflare/Access/Organization.ts` (beta.81, `observe`, line 338) reads it the same way. The
 *   app's OIDC issuer host is that same domain, which is what `checkTeam` already compares after
 *   the write.
 * ⚠️ BUT IT IS A DIFFERENT API-TOKEN PERMISSION than the one that writes the app. Cloudflare's docs
 *   (developers.cloudflare.com/fundamentals/api/reference/permissions, read 2026-10-09) give
 *   `Access: Organizations Read` (or `Access: Organizations, Identity Providers, and Groups Read`)
 *   for this endpoint, while creating an Access application needs `Access: Apps and Policies
 *   Write` (the same docs, e.g. cloudflare-one/access-controls/ai-controls/secure-mcp-servers). So
 *   a token minted only for the app write may be refused here.
 * ★ THEREFORE THE CHECK IS ADVISORY WHERE IT CANNOT READ, AND STRICT WHERE IT CAN. Refused only when
 *   the organization was read and names a different domain. A token that may not read it
 *   (`Unauthorized`, `Forbidden`) or an account with no organization (`OrganizationNotFound`)
 *   gives no answer, and the create goes on exactly as before, with the post-write `checkTeam`
 *   still the backstop: that is the documented known limit (docs/saas-oidc.md). Any other failure
 *   (a throttle, a 5xx) fails the run here, before a write; run again.
 * ★ ONE ATTEMPT (`Retry.none`, retry.ts:48-51). The SDK's default policy retries "Authentication
 *   error", which is what a token without the permission gets, up to eight times with backoff
 *   (core retry.ts `makeDefault`): a first create would wait for an answer it can never get.
 */
import * as Retry from '@distilled.cloud/cloudflare/Retry';
import * as zeroTrust from '@distilled.cloud/cloudflare/zero-trust';
import * as Effect from 'effect/Effect';
import { SaasOidcError, withheld } from './saas-oidc-error.ts';

/**
 * ⚠️ WHY A TAG PREDICATE AND NOT `catchTags` for these three. `Forbidden` is built by the SDK's 4xx
 *   mapping (protocol.ts:164-169 for code 10001, :423-436 for a bare 403) but is not in this
 *   operation's declared error union (it lists `Unauthorized`, `OrganizationNotFound`, … only), so
 *   `catchTags({ Forbidden })` does not typecheck. Which of `Unauthorized` (code 10000 "Authentication
 *   error", protocol.ts:155-158) and `Forbidden` (10001 "Method not allowed for token") a token
 *   without the permission gets was not measured live, so both stand. Tag equality only: no status,
 *   no message, as `retryTransient` in saas-oidc-api.ts does.
 */
const cannotRead = (error: { readonly _tag: string }): boolean =>
  error._tag === 'Unauthorized' ||
  error._tag === 'Forbidden' ||
  error._tag === 'OrganizationNotFound';

/** The organization's `auth_domain`, or `undefined` when this token cannot read it or there is none. */
const readAuthDomain = (accountId: string) =>
  zeroTrust.listOrganizationsForAccount({ accountId }).pipe(
    Retry.none,
    Effect.map((organization) => organization.authDomain ?? undefined),
    Effect.catchTag('CloudflareParseError', withheld('organization read')),
    Effect.catchIf(cannotRead, () => Effect.succeed(undefined)),
  );

/**
 * A refusal when the account's organization is read and its domain is not the declared one; else
 * `undefined` (it matches, or it could not be read, see above). Hostnames compare case-insensitively.
 */
export const checkTeamBeforeCreate = (accountId: string, teamDomain: string) =>
  readAuthDomain(accountId).pipe(
    Effect.map((authDomain) =>
      authDomain === undefined || authDomain.toLowerCase() === teamDomain.toLowerCase()
        ? undefined
        : new SaasOidcError({
            message: `SaasOidcApplication declares teamDomain "${teamDomain}" but this account's Zero Trust organization is "${authDomain}". Refused before any write; no application was created.`,
          }),
    ),
  );
