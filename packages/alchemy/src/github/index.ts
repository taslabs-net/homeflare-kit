/**
 * GitHub helpers for Alchemy — one repository's house policy in one call.
 *
 * ⛔ THIS SUBPATH SHIPS NO PROVIDER, AND DELIBERATELY SO. GitHub is first-class in
 *   Alchemy; everything here composes the vendor's own `Repository` and `Ruleset`.
 *   Provide `GitHub.providers()` exactly as you would without it.
 * ★ WHY IT EXISTS ANYWAY. "Open a pull request, let auto-merge land it" is safe only when
 *   five repository properties and four ruleset rules all agree, and every way of getting
 *   one of them wrong is silent — an auto-merge that lands on red, a force push that
 *   rewrites the branch a release tagged, a required context nothing ever reports. One
 *   call puts the whole policy in one place, and one place is where it gets fixed.
 *
 * ⛔ THIS BARREL IS THE PUBLIC API. `repo-policy-form.ts` is reachable by path if you
 *   genuinely need an internal — a deliberate act rather than an accident of barrelling.
 */
export {
  type RepoPolicy,
  type RepoPolicyBypassActor,
  type RepoPolicyOptions,
  type RepoPolicyRepositorySettings,
  repoPolicy,
} from './repo-policy-form.ts';
export { type DeclareRepoPolicyOptions, declareRepoPolicy } from './repo-policy.ts';
