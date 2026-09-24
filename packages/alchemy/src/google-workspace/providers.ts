/**
 * Every Google Workspace provider, wired once — the same role `litellmProviders`/`netboxProviders`-
 * style helpers play elsewhere in this kit (S16: "a subpath's `providers()` plays the same role" as
 * upstream's `Providers.ts`).
 *
 *     Layer.mergeAll(googleWorkspaceProviders(), …the stack's other providers)
 *
 * ⚠️ CREDENTIALS ARE NOT A PARAMETER HERE. Every handler already closes over
 *   `CredentialsFromEnv` inside `resource.ts` (`GOOGLE_ACCESS_TOKEN`, resolved at call time — see
 *   credentials.ts), so this layer only wires the four resource providers together. `HttpClient`
 *   is NOT provided here either — it is ambient in every Alchemy runtime, the same note
 *   `litellm/providers.ts` makes for its own family.
 */
import * as Layer from 'effect/Layer';
import { GoogleWorkspaceDomainAliasProvider } from './domain-alias.ts';
import { GoogleWorkspaceGroupProvider } from './group.ts';
import { GoogleWorkspaceGroupMemberProvider } from './group-member.ts';
import { GoogleWorkspaceOrgUnitProvider } from './org-unit.ts';

export const googleWorkspaceProviders = () =>
  Layer.mergeAll(
    GoogleWorkspaceGroupProvider(),
    GoogleWorkspaceGroupMemberProvider(),
    GoogleWorkspaceDomainAliasProvider(),
    GoogleWorkspaceOrgUnitProvider(),
  );
