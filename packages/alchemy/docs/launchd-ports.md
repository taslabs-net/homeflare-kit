# Port collisions, before a job is declared — `claimPorts()`

Status: active
Verified: 2026-09-23

`claimPorts(claims)` refuses two of a stack's own jobs sharing one port number, in the stack's own
program, before `alchemy plan` asks a single provider anything. It is not a provider and it is not
a `LaunchdJob` prop — it is a plain function a host stack calls itself, the same shape as
[`catalogBinary()`](../src/release/catalog.ts) (see [release-binary-upstream.md](./release-binary-upstream.md)).

```ts
import { claimPorts } from '@homeflare/alchemy/launchd';

claimPorts([
  { owner: 'vmalert', port: 8880 },
  { owner: 'vmalert-logs', port: 8881, address: '127.0.0.1' },
]);
// ...then declare the jobs themselves, as normal.
```

## Why the stack program, not a provider

Two structural facts about Alchemy 2.0.0-beta.79 rule out a provider-side check:

- **A provider never diffs a first `create` whose props still hold an unresolved `Output`.**
  Every mini job's `programArguments` carries a `HostFile` config digest as an `Output`, so a
  check living in `LaunchdJob`'s `diff` would be skipped on exactly the deploy that matters most —
  the first one.
- **A provider never sees its sibling resources.** Nothing in the `LaunchdJob` handlers can read
  what port another declared job holds; the stack program is the only place that sees the whole
  set at once.

So `claimPorts` runs where the stack itself calls it, ordered however the stack likes (typically
right before the jobs it describes), and fails the **plan** — nothing is fetched, written, or
`launchctl`'d — if two claims collide.

## Why it keys on the port number alone

`house/nix/homeflare-config/hosts/macmini/modules/lib-ports.nix` (a different repo —
`homeflare/homeflare`, read at `92cff7f`, 2026-09-23) is the check this replaces for a
kit-declared job. Its `assertNoCollision` is:

```nix
dupes = lib.subtractLists (lib.unique vals) vals;  # vals = lib.attrValues ports
```

— every port **value** in the registry, address and protocol never read. `portClaimProblems`
reproduces that rule rather than a looser one, because that is the strictness the registry already
enforces across the whole estate, and a kit-side check that disagreed with it would be a second,
inconsistent source of truth.

### The measured bind table

What that trades away is real: the OS itself is looser than the registry. Measured on the mini
(Darwin 27.2.0) with `/usr/bin/python3` sockets, `SO_REUSEADDR` set on both sides, loopback high
ports — first on 2026-09-23 at 47913–47917, **re-measured independently the same day** at
47923–47927 with the same result:

| first bind          | second bind | outcome                  |
| ------------------- | ----------- | ------------------------ |
| `127.0.0.1`         | `127.0.0.1` | **refused** — EADDRINUSE |
| `0.0.0.0`           | `127.0.0.1` | both bind                |
| `127.0.0.1`         | `0.0.0.0`   | both bind                |
| `[::]` (`V6ONLY=0`) | `127.0.0.1` | both bind                |
| `[::1]`             | `127.0.0.1` | both bind                |

Only an **exact** address+port duplicate fails at bind time; a wildcard next to a specific address
on the same port silently splits traffic between two listeners instead of refusing. `claimPorts`
refuses that pairing anyway — the port number is the key, exactly like the registry — because
"the OS allowed it" is not the same claim as "the estate meant two things to share a port."

- **Every mini daemon this affects is Go**, and Go sets `SO_REUSEADDR` on **every** darwin
  listener unconditionally: `setDefaultListenerSockopts` in `net/sockopt_bsd.go` (Go 1.26.5,
  installed at `/opt/homebrew/Cellar/go/1.26.5`, `//go:build darwin || …`) —
  `syscall.SetsockoptInt(s, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)`, no opt-out. The
  Victoria family, Prometheus-family exporters and OpenBao are all Go, so the table above is their
  actual behaviour, not a worst case.
- **vector is Rust.** Whether it also sets `SO_REUSEADDR` by default is **unmeasured** — say so
  rather than assume Go's default carries over.
- **launchd itself has no port concept to collide on.** `man 5 launchd.plist`'s only socket-shaped
  key is `Sockets` (launch-on-demand socket activation via `launch_activate_socket(3)`), and no
  `LaunchdJobProps` today exposes it — a daemon binds its own port itself, launchd never mediates
  it. So this check is squarely about daemons colliding with each other at bind time, not about
  anything launchd enforces.

## What it cannot see

- **A job the stack does not pass.** `claimPorts` takes exactly the array a stack builds and
  hands it; there is no argv-parsing, no config-file reading and no host inspection here to
  recover a port a stack forgot to include. Leaving a job's claim out of the list is invisible to
  this check, the same way a port left out of `lib-ports.nix` was invisible on 2026-09-02.
- **A daemon still on Nix**, unless the migrating stack also passes that daemon's port as a claim
  of its own (owner naming the Nix job, so the message is legible during a cutover). Until a job
  moves off Nix, `lib-ports.nix` is still the thing keeping it collision-free; `claimPorts` only
  starts covering a port once a kit stack declares the job that binds it.
- **Two protocols of the same port number.** Keying on the port alone means a daemon on `tcp/9094`
  and another on `udp/9094` would be refused as a collision, same as the Nix registry. No mini job
  does that today (checked against the registry at `92cff7f`); if one needs to, the key widens
  deliberately, in its own change — not silently here.

## The error is a defect, not a typed channel

`claimPorts` throws `PortRefused` (a `Data.TaggedError`), and like `catalogBinary()`, that throw
inside a stack program's `Effect.gen` body is a **defect** — `Effect.catchTag('PortRefused', …)`
never sees it, only `Effect.runPromiseExit` plus `Cause.hasDies`/`Cause.squash`. This is the exact
gap [release-binary-upstream.md](./release-binary-upstream.md) names as gap 10 for
`catalogBinary()`; it applies here unchanged because it is the same shape of function in the same
kind of caller, not a new hole. `port-claims.test.ts` measures it the same way
`error-channel.test.ts` measures `catalogBinary()`'s.
