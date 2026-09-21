# Ownership — nothing is adopted without `--adopt`

A live object this stack holds **no state for** is never taken over silently. That holds for every
`Bao.*` family, `HostFile`, `LaunchdJob` and `CaddyConfig`, and it holds even when the live object
is **identical** to the declaration: identical is not ours. Another stack, a person or an old
script put it there, and once state claims it, a delete under `RemovalPolicy.destroy()` removes it
from its real owner. (Decided 2026-09-21; the Bao families adopted silently until 0.9.0.)

To take an object over, say so:

```sh
alchemy deploy --adopt            # every resource in this deploy
```

```ts
import { adopt } from 'alchemy/AdoptPolicy';

// this resource only
export const app = BaoPolicy('app', { fragments: './policies/app', name: 'app' }).pipe(adopt(true));
```

A resource-scoped `adopt(…)` wins over the flag, both ways: `.pipe(adopt(false))` stays refused
under `--adopt`.

## Where it is checked

| when                                | what happens to a live object with no state                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| **plan** — Alchemy's adoption probe | `read` answers `Unowned`; the plan fails with `OwnedBySomeoneElse` unless adoption is on |
| **apply** — the probe never ran     | `reconcile` refuses before any write unless adoption is on                               |

Alchemy skips the probe while a prop is still an `Output` (it comes from a resource created in the
same deploy), and it never probes the new generation of a replace. An object can also appear
between plan and apply. So each family checks again in `reconcile`, reading the object before it
writes, and resolves `--adopt` / `adopt(…)` exactly as the planner does
(`src/ownership/adopt.ts`).

- A refused create also **forgets the `creating` row** Apply wrote for it, so the next plan probes
  again and refuses again. Left behind, that row's recovery read could have adopted the very object
  the apply refused (measured: `Bao.Mount` and `Bao.AuthMethod`, whose omitted props are not managed).
- `Bao.Mount` / `Bao.AuthMethod`: a create with `remountFrom` moves a live mount that this stack
  holds no state for. That move is a takeover too, and it is refused the same way.
- `HostFile` / `LaunchdJob`: `--adopt` lets a **create** take the file or job over. A rename onto
  an occupied path or label stays refused, as it is at plan time.

## Crash recovery still works

A deploy that dies after its write and before its commit leaves a `creating` (or `replacing`) row
and a live object. The next deploy finishes it **without** `--adopt`:

- **An interrupted create.** Alchemy's recovery read passes the row's own instance id, which the
  state store records (a probe's id is freshly minted, so no row holds it). The object is ours when
  it also matches that row's props. If it does not, it may have lost a race to someone else, so it
  is `Unowned`: the plan says `Cannot resume creating`, and `--adopt` resumes it.
- **An interrupted replace.** Alchemy never probes a `replacing` row; it calls `diff`, and a row
  with no attributes is exactly an unfinished generation. The diff notes the instance in Alchemy's
  per-deploy `Artifacts` bag, and the apply that follows (same instance id) lets its own object
  through.

⚠️ **A multi-step create interrupted halfway is not proven ours.** `Bao.Mount` enables, then tunes.
If the deploy dies between the two, the mount does not match its props, and the resume needs
`--adopt`. That is the safe direction.

⚠️ **It fails closed.** If plan and apply do not share an `Artifacts` bag, or the store cannot be
read, a resume reads as a fresh create and asks for `--adopt`. `alchemy deploy` and the Alchemist
session both share one.

## Limits

- ⚠️ **A check, then a write: not a lock.** Two resources that declare the same name in **one**
  deploy create concurrently. Both read nothing, and both write (measured with the fakes). Declare
  each name once.
- ⚠️ **A resumed row trusts what it finds at apply.** The same note covers a `creating` row whose
  recovery read found nothing, and every `replacing` row: if an object appears at that identity
  before the apply, it is written over as ours. The note cannot tell it from our own. For the Bao
  families this takes a race — a replace onto an occupied identity already fails the plan.
- ⚠️ **`HostFile` and `LaunchdJob` answer `Unowned` to the recovery read too.** A create of theirs
  interrupted after its write needs `--adopt` on the next deploy. Both remove what a failed create
  wrote, so this needs a kill between the write and the commit.
- ⚠️ **`CaddyConfig` keeps its own probe.** A running config identical to the declaration reads as
  ours, because adopting it changes nothing Caddy serves ([caddy.md](./caddy.md#adoption)).
