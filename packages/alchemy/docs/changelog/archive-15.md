# Alchemy changelog archive 15

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

⚠️ **The ruleset half cannot adopt.** Alchemy's `Ruleset` reports nothing without prior state and
creates unconditionally, and GitHub allows two rulesets with one name — so a first deploy onto a
repository that already has one adds a second, both enforcing. `GitHub.Repository` does not share
the problem. Check `gh api repos/<owner>/<repo>/rulesets` first, or pass your own `rulesetName`.
See `docs/repo-policy.md`.

### Patch Changes

- [#101](https://github.com/taslabs-net/homeflare-kit/pull/101) [`2e43257`](https://github.com/taslabs-net/homeflare-kit/commit/2e4325741b1264feb4069712e2da1dc28c7f9ac3) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `repoPolicy` refuses two more ways to build a ruleset that matches no ref: a blank ref
  pattern (`include: ['   ']` has length 1, so the empty-array guard passed it) and an
  `exclude` that cancels every `include` (exclusions win in a GitHub ruleset, so it reads
  as a narrowing and acts as an off switch). Both produced an `active` ruleset over nothing
  with `allowAutoMerge: true` — the end state the auto-merge guard exists to prevent.
  Include and exclude patterns are now trimmed, de-duplicated and sorted like `checks`.

  `docs/repo-policy.md` also records, measured against live GitHub rather than inferred,
  that the ruleset half never plans a no-op, and that its `rules` and `bypass_actors` are
  replaced wholesale rather than merged.

## 0.13.0

### Minor Changes

- [#95](https://github.com/taslabs-net/homeflare-kit/pull/95) [`4fc9a38`](https://github.com/taslabs-net/homeflare-kit/commit/4fc9a38d5f2f9513d75edad99edaf8b9005afc30) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Proxmox notifications that page. `@homeflare/alchemy/proxmox` adds three adopt-capable families and
  a webhook body:

  - **`PbsNotificationTarget`** — PBS `webhook`, `smtp` and `sendmail` targets. Secret fields are
    **write-only**: a webhook `secret`, the smtp `password` and any credential-bearing `header` are
    declared as `{ fromEnv: 'VARIABLE' }` and read by the deploying process at call time. No value
    reaches Alchemy state — the store keeps names, a fixed-salt scrypt digest of the live headers, and
    a random-salt seal of what the provider last wrote. A plan diffs on those (hash or presence), a
    plan without the variables is presence-only, a rotated value is PUT alone, and a write that needs
    a missing variable fails by the variable's name before any request.
  - **`PbsNotificationMatcher`** and **`ProxmoxNotificationMatcher`** — `match-severity`,
    `match-field`, `match-calendar`, `targets`, `mode`, `invert-match`, `comment`, `disable`. A matcher
    is compared as its whole rule; both built-in `default-matcher`s adopt as-is with no write.
  - **`alertmanagerAlertBody()`** — a PBS webhook body template that posts one Alertmanager v2 alert
    (`/api/v2/alerts`; labels `alertname`, `severity`, `source`, `job_type`, `job_id`, `datastore`,
    `hostname`; annotations `summary`, `description`). Every value goes through `json`, and every
    optional field is guarded, so a GC failure (no `job-id`) and the UI's field-less Test notification
    both render valid JSON.
  - `FromEnv` is exported. The PVE and PBS generated API types now cover the notification endpoints
    and matchers, and the shared PVE read treats a `{"data": null}` answer as absent instead of
    throwing.

  Guide: `docs/pbs-notifications.md`.

### Patch Changes

- [#97](https://github.com/taslabs-net/homeflare-kit/pull/97) [`1c746d2`](https://github.com/taslabs-net/homeflare-kit/commit/1c746d26334444d8ef8270fcba857035391b11e0) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Pbs.NotificationTarget` now refuses a literal credential in a plain prop, and does so at plan,
  before anything is stored.

  - The target refuses an `Authorization`, `Proxy-Authorization` or `Cookie` header, a header or URL
    query parameter named like `token`, `key`, `secret`, `password` or `signature`, and a password in
    the URL's userinfo. Each must be declared `{ fromEnv }` or read `{{ secrets.<name> }}`. Before
    this change, such a value planned, deployed, and stayed in the state store. A target already
    deployed that way now fails its plan until the literal is moved; the next deploy then replaces
    the stored props.
  - Refusals now run in Alchemy's adoption probe as well as in `diff`. A new target used to be
    refused only in `reconcile`, after Alchemy had already committed its props to state.
  - `alertmanagerAlertBody()` refuses a `generatorURL` that is not an absolute http(s) URL.
    Alertmanager rejects the whole post for one.
  - Docs: `docs/pbs-alertmanager-body.md` shows the exact template text. The old block had been
    reflowed by the formatter. PVE's per-matcher read needs `Mapping.Audit` or `Mapping.Modify`;
    `Mapping.Use` is not enough.

## 0.12.0

### Minor Changes

- [#90](https://github.com/taslabs-net/homeflare-kit/pull/90) [`de65267`](https://github.com/taslabs-net/homeflare-kit/commit/de652677804581b1dd431d3930d6656ac760037f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - **New: the provisioning baseline, one description for every cluster and node.**
  `@homeflare/alchemy/proxmox` now exports:

  - `PROVISION_PRIVILEGES`: the provision role's 27 privileges as one sorted, frozen constant. It is
    the union of what every family's reconcile needs, including what the lane needs to manage the
    baseline itself.
  - `PROVISION_DEFAULTS` and `provisionBaseline(names)`: generic names (role `HfProvisioner`, users
    `hf-provision@pve` and `hf-read@pve`, group `hf-mint`, read role `PVEAuditor`), overridable per
    site. Names that are not PVE-shaped or would need shell quoting are refused.
  - `declareProvisionBaseline(id, target, names?, { adopt? })`: declares the role, the mint group,
    one user per lane (its group membership included) and the grant for each lane on `/`. Every
    resource retains, and `adopt` is piped only when asked.
  - `provisionBootstrap(names?)`: a pure generator of the one-time root commands for a new cluster
    or node, as a POSIX `sh` script. It checks each object before changing it, so it is idempotent,
    and it never creates a token or sets a password.

  The provision lane cannot create itself, so root bootstraps it once, then the stack adopts it and
  keeps it. After the bootstrap, the declaration is a clean adoption that writes nothing. See
  `docs/provision-baseline.md`.

### Patch Changes

- [#89](https://github.com/taslabs-net/homeflare-kit/pull/89) [`94fbc2f`](https://github.com/taslabs-net/homeflare-kit/commit/94fbc2f0f8471e64164b4c77418140c0fcf28cce) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The adopt verifier's guide now says what `alchemy drift` does in alchemy 2.0.0-beta.79. It has no dry run and no `--yes`, although its docs page lists one: `alchemy drift --yes` fails with `Unrecognized flag`. A non-interactive run prints the repair plan and exits `0` even when something drifted, so it cannot gate a deploy. `--repair` restores the props saved at the last deploy, not what the code declares now, and it writes without a prompt, outside the deploy gate. The ownership guide now says that recovering from a wiped state store, or from `alchemy state delete`, needs `--adopt` for every family that follows the ownership rule, and for `MeshNode` and `R2BucketLock`. Alchemy's docs say objects with no ownership marker re-import without the flag, but many of Alchemy's own marker-less providers refuse them too, as the kit does. The exceptions are a `CaddyConfig` running the declared config, and the families whose `read` never answers `Unowned`: the `pveHandlers`, `forgejoHandlers` and Talos resources.

- [#94](https://github.com/taslabs-net/homeflare-kit/pull/94) [`745d941`](https://github.com/taslabs-net/homeflare-kit/commit/745d94161b5cdd63c8d8ebd40a730c8b8b931ff7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Docs only. The changelog marks 0.9.0 as never published (no npm version, no git tag): its changes first shipped in 0.10.0, and the README, the openbao README and the ownership guide now say so where they cite 0.9.0. The `Proxmox.Storage` header no longer says the estate's provision role lacks `Datastore.Allocate`: it was widened, and the provisioning baseline carries it.

- [#93](https://github.com/taslabs-net/homeflare-kit/pull/93) [`d3c332b`](https://github.com/taslabs-net/homeflare-kit/commit/d3c332bd4f175cc3510b7ae06ff98f4b426f0c52) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The published sources, docs and examples no longer name the maintainer's own infrastructure.
  Node names, cluster and pool names, NICs, VLANs, addresses, hostnames, guest ids, principals and
  policy names in comments, fixtures and examples are now neutral placeholders: nodes `node-a`…
  `node-d`, a reference cluster `C1`, documentation addresses (RFC 5737), `bao.example.internal`.
  Measured facts are unchanged; only the names are. `site.example.json` names its hosts `node-a`…
  `node-c`. One runtime message changed: `forgejo-bootstrap` now says to run on "the host where
  Forgejo runs". The historical CHANGELOG entries are unchanged.

## 0.11.0

### Minor Changes

- [#87](https://github.com/taslabs-net/homeflare-kit/pull/87) [`520926f`](https://github.com/taslabs-net/homeflare-kit/commit/520926fd81230025bb5337a2b0ea72992c0ccf7f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - **Breaking: a `ProxmoxLxc` adoption never changes a guest.** When a guest is adopted — found by
  the adoption probe with no state, or an interrupted create resumed under `--adopt` that the plan
  could not prove its own — any key the declaration says otherwise now FAILS the plan, naming the
  keys and never their values:

  ```
  CT 100 on pve1: adopting it would change memory, net1. An adoption never changes a guest, so
  nothing is written. …
  ```

  Only an exact match adopts, and its deploy writes nothing. Before, such a plan said `adopted`,
  only logged the keys as a warning, and `deploy --adopt --yes` wrote them. The deploy asks again
  against a fresh read, so a hand edit between plan and deploy is refused rather than written back.
  To change a guest, adopt it as it runs first; the change is then an ordinary `update`. The
  ownership rules are unchanged: nothing is adopted without `--adopt` or `adopt(true)`, and an
  interrupted create proven its own still resumes and writes. See `docs/proxmox-lxc-adopt.md`.

## 0.10.1

### Patch Changes

- [#85](https://github.com/taslabs-net/homeflare-kit/pull/85) [`61249dc`](https://github.com/taslabs-net/homeflare-kit/commit/61249dce57ec7a3ba319246074ba7e431a9927fc) Thanks [@taslabs-net](https://github.com/taslabs-net)! - **Fix: `hf-adopt-verify` no longer passes a drifted adoption whose provider's `diff` never looks at
  the live object.** Alchemy gives an adopted row's `diff` the declaration as its recorded props, so
  a diff that compares recorded props with the declaration says `noop` whatever the cloud holds.
  Alchemy's own `Cloudflare.R2Bucket` diff works that way. The verifier printed `ok` and exited `0`
  while listing the drift under `changed`, and the deploy then wrote it. Now an adopted `noop` with
  something under `changed` gets its `diff` run a second time, with the live values of those fields
  passed as the recorded props (still read-only, and write paths are still refused). A second
  `noop` passes with a note that the family does not manage those fields. Any other answer fails
  the row. The answer appears as `recheck` in the JSON report. No kit PVE/PBS family is affected:
  each one's `diff` re-reads the cluster.

  **Fix: the default report no longer hides a `create` when a rename hands its old id to a new
  resource.** A row now counts as stateful only when it plans from the state row it reads, rather
  than any row that happens to sit at its FQN.

## 0.10.0

### Minor Changes

- [#84](https://github.com/taslabs-net/homeflare-kit/pull/84) [`eb2fd8b`](https://github.com/taslabs-net/homeflare-kit/commit/eb2fd8b0a7f332731316ceedfa9af3a619616e95) Thanks [@taslabs-net](https://github.com/taslabs-net)! - ⚠️ **BEHAVIOUR CHANGE — three silent takeovers in 0.9.0's ownership rule closed, and `sudoRunner()`
  refuses more.** Found by an adversarial review of 0.9.0, each measured through Alchemy's own plan
  and apply before the fix, and each now refused, writing nothing. It narrows two 0.9.0 notes: crash
  recovery without `--adopt` needs a row that can prove the object ours, and `--adopt` at apply
  never covers a fresh replace's new generation.

  - **A `Bao.*` create killed before its ownership check no longer resumes onto someone else's object.**
    Apply writes the `creating` row before `reconcile` runs, and drops any prop still an `Output`
    from it. With the name an Output, the next deploy "resumed" that create and wrote over another
    owner's role (all nine role and MFA families, and `Bao.Mount` by path). With a knob an Output,
    `Bao.Mount` and `Bao.AuthMethod` read the missing prop as "not managed", adopted another owner's
    mount and tuned it. A state row now proves an object ours only when it carries every value the
    declaration names, and a resume is let through only when the family's own `read` proves the
    object that generation's — for every `Bao.*` family and `ProxmoxLxc`. **So a create killed
    while a prop was still an Output now needs `--adopt` to resume.**
  - **An interrupted `Bao.*` replace no longer writes over what another owner put at its new
    identity since**, unless `--adopt`.
  - **`--adopt` at apply now covers a create or an interrupted generation, never a fresh replace's
    new generation**, for every `Bao.*` family, `HostFile` and `LaunchdJob`. The planner never
    offers adoption there, yet a deploy-wide `--adopt` let a `HostFile` whose path changed overwrite
    a file it did not own at the new path.
  - **`sudoRunner()` also refuses** (⚠️ a prefix 0.9.0 accepted can now fail): a directory _above_ the
    prefix, from `/` down, that root does not own alone (whoever may write the prefix's parent can
    swap the prefix itself; a root-owned symlink such as `/etc` is still followed), and any ACL entry
    from `/` down to the file that grants a write right (read with `ls -lden`, as the operator; deny
    entries pass; unreadable ACLs refuse). Both run before sudo and, through `checkWrite`, at plan
    time.

  `docs/ownership.md` and `docs/launchd-sudo.md` carry the details and the limits.
