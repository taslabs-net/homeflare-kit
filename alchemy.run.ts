/**
 * Adopt this GitHub repo with the vendor provider.
 *
 * ⛔ NOT `@homeflare/alchemy`. That package is Forgejo / Proxmox / OpenBao / Talos
 *   / R2 locks — systems Alchemy has none for. GitHub is first-class (`alchemy/GitHub`).
 * ★ THE USEFUL OBJECT IS Environment "npm". release.yml publishes from it.
 * ⛔ NPM_TOKEN STAYS A REPOSITORY SECRET. Putting it in the stack would write the
 *   token into Alchemy state. GitHub still injects repo secrets into an
 *   environment job.
 * ★ STATE IS `Cloudflare.state()` — the account Durable Object already used by
 *   homeflare-forgejo, homeflare-proxmox, …. Keys live in Secrets Store as
 *   AlchemyStateStoreToken / AlchemyStateStoreEncryptionKey (Schenanigans,
 *   measured 2026-09-16 via wrangler). Do not bootstrap a second store.
 * ⚠️ Deploy with `--stage live`. The CLI default is `live_$USER`, which would
 *   fork a per-laptop copy. Other HomeFlare stacks on this store use `live`.
 * ⛔ DO NOT DECLARE BRANCH PROTECTION. The `main` ruleset already owns it.
 */
import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as GitHub from 'alchemy/GitHub';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

const OWNER = 'taslabs-net';
const NAME = 'homeflare-kit';

// oxlint-disable no-default-export -- Alchemy CLI loads the default export of alchemy.run.ts.
export default Alchemy.Stack(
  'HomeFlareKit',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const repo = yield* GitHub.Repository(NAME, {
      owner: OWNER,
      name: NAME,
      deleteBranchOnMerge: true,
      hasWiki: false,
    });

    yield* GitHub.Environment('npm', {
      owner: OWNER,
      repository: NAME,
      name: 'npm',
      deploymentBranchPolicy: { customBranchPolicies: ['main'] },
    });

    return { repo: repo.fullName };
  }),
);
