# Adopt verifier — `adopted` must mean no-op

`hf-adopt-verify` plans a stack with Alchemy's own planner, never writes, and reports for each row
**without a state row** what the provider's `read` and its own `diff` said. It exits `0` only
when every such row is a no-op. Run it before any gated deploy that adopts.

```sh
bunx --bun hf-adopt-verify --config alchemy.run.ts --stage live          # rows without state
bunx --bun hf-adopt-verify --config alchemy.pbs.ts --stage live --all    # every row + deletions
```

Wrap it in the same credential lane the deploy uses (the wrapper that mints
its OpenBao token): a lane that cannot read an object sees it as absent, and the verifier
then reports `create` for something that exists.

## Why a plan line is not enough

Measured in alchemy `2.0.0-beta.79`:

- `Plan.ts`: when a row has no state, the engine calls `read` (the adoption probe). If the object
  exists it sets `forceUpdateAfterAdoption`, calls `diff`, and turns a `noop` into `update`. The
  node is `adopted` either way. Nothing is logged.
- `Apply.ts`: `adopted` goes down the `update` branch and calls `reconcile` with `olds: undefined`.
- So `alchemy plan` prints `(+) adopted` for a matching object **and** for a drifting one, and
  the deploy reconciles both. Whether that writes is up to each family's `reconcile`.

Measured on C1, `pvesh get /cluster/tasks`, 2026-09-21: six `cephsetpool` tasks by
the provision user, one per pool, on 2026-09-13 and again on 2026-09-20 — the deploys that
adopted the three Ceph pools. `Proxmox.CephPool` sent `setpool` whenever the pool existed,
whatever its diff said. It was the one PVE/PBS family that wrote on a no-op adoption, and it is
fixed. [adopted-deploys.md](./adopted-deploys.md) shows what every family does.

## Where the answer is taken from

| looked at                  | what it offers                                                  |
| -------------------------- | --------------------------------------------------------------- |
| `alchemy plan` (CLI)       | the forced action only; `--detailed` is declared YAML, no JSON  |
| `Plan.describePlan`        | serializable rows, again only the forced action                 |
| `forceUpdateAfterAdoption` | a local variable; no log, no warning, no field on the node      |
| `alchemy drift`            | rows **with** state only, and its non-dry run reconciles        |
| `deploy --adopt --dry-run` | the adoption plan (`plan` has no `--adopt`), same forced action |
| **the provider service**   | the raw `read` / `diff` answer, per FQN — used                  |

The engine finds every provider in the Effect context by resource type. The verifier opens the
stack the way `alchemy plan` does (`Alchemist.open`). It swaps each provider for a watched copy
(`src/verify/spy.ts`) and runs `Plan.make` itself, so output resolution, state lookup, renames,
the adoption probe and `adopt(…)` are all still Alchemy's. The copy records what `read` and
`diff` answered. `reconcile`, `delete` and `precreate` are replaced with a refusal, so a
verification cannot write even by accident.

## The report

```text
      planned  diff      read       type        fqn
FAIL  adopted  update    found      Test.Thing  drifted  changed: comment
      the provider's diff says update: the deploy writes
ok    adopted  noop      found      Test.Thing  same
```

| column    | meaning                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| `planned` | the engine's action — what `alchemy plan` prints                                         |
| `diff`    | the provider's own answer before Plan.ts forced it; `none` = no diff; `not-run`          |
| `read`    | `found`, `unowned` (the deploy needs `--adopt`), `absent`, `failed`, `not-read`          |
| `changed` | declared fields whose live value differs, **names only**, same-named keys of props/attrs |

A row is a no-op when `planned` is `adopted` or `noop`, the provider said `noop`, **and** no
binding changes (Plan.ts diffs bindings separately and `reconcile` applies them anyway). An
adopted row whose provider has no `diff` is not proven: the engine compared the declaration with
itself. A row with state and no diff is trusted at `noop`, as `alchemy plan` trusts it. A stack
task (an Alchemy action) that will `run` is always a failing row: no provider sees it.

An adopted `noop` with something under `changed` is asked once more (`src/verify/recheck.ts`).
Plan.ts hands an adopted row's `diff` the declaration as its recorded props (`olds: news`), so a
diff that compares recorded props with the declaration answers `noop` whatever the cloud holds.
Alchemy's own `Cloudflare.R2Bucket` diff has that shape (`olds.domains` against `news.domains`).
The replay passes the read's values for the changed fields as `olds`. A diff that reads the live
object ignores them and says `noop` again, so the row passes with a note: the family does not
manage those fields (CephPool's autoscaled `pg_num`). Anything else fails the row, and the JSON
report carries the answer as `recheck`. Before this check, such a row passed with its drift
listed beside the `ok`.

Exit codes: `0` all no-op (or nothing to verify), `1` any row is not, `2` the plan could not be
computed (a provider died, an `adopt(false)` row is not ours, state unreadable). A gate should stop
on anything but `0`.

## Flags and API

`--config` / `-c`, `--stage`, `--profile`, `--env-file` behave as in `alchemy plan`. The
difference is that `--stage` is never guessed: it comes from the flag or `$ALCHEMY_STAGE`, or the
run stops. `--all` adds every row with state (read again) and every pending delete. `--json`
prints the report.

```ts
import { verifyStack, formatReport, exitCodeOf } from '@homeflare/alchemy/verify';

const report = await Effect.runPromise(
  verifyStack({ entrypoint: 'alchemy.run.ts', stage: 'live' }),
);
```

`verifySession({ stack, context })` takes an already-opened session. The kit's own tests pass it
a compiled stack (`src/verify/fake-engine.ts`).

## Limits

- ⚠️ **`noop` covers what the family compares.** A family's `diff` and its `reconcile` guard share
  one predicate (`matches`). A field that `matches` leaves out is never written on a no-op
  adoption and never reported. `Proxmox.CephPool` `target_size_ratio` is the known case.
- ⚠️ **`changed` is not the verdict.** It compares same-named keys, and only decides whether an
  adopted `noop` is asked again. A drift in a field the attributes rename or normalise shows
  nothing there, and a diff that ignores the live object then goes unchallenged.
- ⚠️ **Reads are what `alchemy plan` does.** A kit PVE/PBS read mints a lease through OpenBao,
  which creates a short-lived API token on the cluster. `--all` adds one read per row with state.
- ⚠️ **Outside the kit, `noop` is only the diff's word.** For a kit PVE/PBS family, `noop` means
  the deploy writes nothing ([adopted-deploys.md](./adopted-deploys.md)). For any other provider,
  `noop` means its diff found nothing. Whether its `reconcile` still PUTs is up to that provider.
- It runs where `alchemy` runs: under bun it needs `@effect/platform-bun`, as the Alchemy CLI
  does. Like `alchemy plan`, it writes a run log under `.alchemy/log/` in the working directory.
