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
- **Adoption at apply is for a create, or an unfinished generation.** The planner offers `--adopt`
  to a resource with no state, and Alchemy offers it to resume an interrupted create; so at apply
  it lets through a `creating` row, or a generation whose row the plan's `diff` saw with no
  attributes (an interrupted create or replace). A **fresh** replace's new generation that finds
  its new identity taken is refused, `--adopt` or not: the plan never asked about that identity
  (measured 2026-09-21: a `HostFile` whose path changed onto a file it did not own overwrote it
  under a deploy-wide `--adopt`). For the Bao families a rename onto a taken identity already fails
  the plan; this keeps the apply to the same answer.

## Crash recovery still works — when the row can prove it

A deploy that dies after its write and before its commit leaves a `creating` (or `replacing`) row
and a live object. The next deploy finishes it **without** `--adopt`:

- **An interrupted create.** Alchemy's recovery read passes the row's own instance id, which the
  state store records (a probe's id is freshly minted, so no row holds it). The object is ours when
  it also matches that row's props. If it does not, it may have lost a race to someone else, so it
  is `Unowned`: the plan says `Cannot resume creating`, and `--adopt` resumes it.
- **An interrupted replace.** Alchemy never probes a `replacing` row; it calls `diff`. For a row
  with no attributes, every Bao family's `diff` first asks its own `read` the recovery question —
  recorded instance, whole row, matching object (`provingResumes`, `src/ownership/resume.ts`) — and
  only a "yes" leaves a note in Alchemy's per-deploy `Artifacts` bag that lets the apply's own
  object through.

⛔ **A row proves nothing by itself.** Apply commits it **before** reconcile runs, so a deploy killed
before the claim (an upstream that failed, a Ctrl-C) leaves a row whose create never asked whose
object sat at its identity. Found by the red team on 2026-09-21 (`openbao/adopt-holes.test.ts`):

- **A row missing part of its declaration proves nothing.** Apply strips a prop that was still an
  `Output` from the row, and most families read an absent prop as "not managed". So the row must
  carry every value the declaration names (`src/ownership/whole.ts`); one with a hole is `Unowned`.
  Measured: a `Bao.Mount` whose `defaultLeaseTtl` was an Output adopted, and tuned, another owner's
  mount; with the name an Output, every role family resumed onto another owner's role.
- **So a create or replace interrupted while a prop was still an Output resumes with `--adopt`.**
  Its row cannot say what it wrote, and that deploy's plan never asked whose object was there.

⚠️ **A multi-step create interrupted halfway is not proven ours.** `Bao.Mount` enables, then tunes.
If the deploy dies between the two, the mount does not match its props, and the resume needs
`--adopt`. That is the safe direction.

⚠️ **It fails closed.** If plan and apply do not share an `Artifacts` bag, or the store cannot be
read, a resume reads as a fresh create and asks for `--adopt`. `alchemy deploy` and the Alchemist
session both share one. An orphan's interrupted create (no longer declared) cannot be compared with
a declaration, so Apply leaves its object in place with a note instead of deleting it.

## Limits

- ⚠️ **A check, then a write: not a lock.** Two resources that declare the same name in **one**
  deploy create concurrently. Both read nothing, and both write (measured with the fakes). Declare
  each name once.
- ⚠️ **Proven at plan, written at apply.** A resume is proven against the object the plan read.
  One swapped for another between that read and the apply is written over. That takes a race.
- ⚠️ **Identical is still ours to a recovery read.** A foreign object identical to a whole row's
  props, at the identity an interrupted create or replace was going to write, reads as ours — the
  rule Plan.ts itself applies to a recovery read.
- ⚠️ **`HostFile` and `LaunchdJob` answer `Unowned` to the recovery read too.** A create of theirs
  interrupted after its write needs `--adopt` on the next deploy. Both remove what a failed create
  wrote, so this needs a kill between the write and the commit.
- ⚠️ **`CaddyConfig` keeps its own probe.** A running config identical to the declaration reads as
  ours, because adopting it changes nothing Caddy serves ([caddy.md](./caddy.md#adoption)).
