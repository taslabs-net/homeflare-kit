/**
 * Adopt this GitHub repo with the vendor provider.
 *
 * ⛔ NOT `@homeflare/alchemy`. That package is Forgejo / Proxmox / OpenBao / Talos
 *   / R2 locks — systems Alchemy has none for. GitHub is first-class (`alchemy/GitHub`).
 * ★ THE USEFUL OBJECT IS Environment "npm". release.yml publishes from it.
 * ⛔ NPM_TOKEN STAYS A REPOSITORY SECRET. Putting it in the stack would write the
 *   token into `.alchemy/` state. GitHub still injects repo secrets into an
 *   environment job.
 * ⚠️ LOCAL STATE ONLY. `.alchemy/` is gitignored. Do not `alchemy deploy` on every
 *   CI push — a fresh runner looks empty and fights the last apply. First apply
 *   is `bun alchemy deploy` on a machine that can administer this repo.
 * ⛔ DO NOT DECLARE BRANCH PROTECTION. The `main` ruleset already owns it.
 */
import * as Alchemy from 'alchemy';
import * as GitHub from 'alchemy/GitHub';
import * as Effect from 'effect/Effect';

const OWNER = 'taslabs-net';
const NAME = 'homeflare-kit';

// oxlint-disable no-default-export -- Alchemy CLI loads the default export of alchemy.run.ts.
export default Alchemy.Stack(
  'HomeFlareKit',
  {
    providers: GitHub.providers(),
    state: Alchemy.localState(),
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
