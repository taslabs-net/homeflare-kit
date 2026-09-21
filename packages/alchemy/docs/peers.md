# Peers — and why each pin exists

The install line for `@homeflare/alchemy`, and why every peer on it and every entry in the
`overrides` block is required. The block itself, which every consumer copies, is in the
[README](../README.md#peers--and-one-override-you-need).

```sh
bun add @homeflare/alchemy alchemy@2.0.0-beta.79 effect@4.0.0-rc.115 \
        @effect/platform-node@4.0.0-rc.115 cloudflare@4.5.0 mime@4.1.0 \
        @distilled.cloud/cloudflare@1.0.0-rc.12
```

🔴 **Why, measured 2026-09-16 on 0.1.0 and re-checked 2026-09-17 against Alchemy 78.**
Effect's `rc` line is not semver-compatible with itself. Alchemy 78's peer is
`effect >= 4.0.0-rc.115`; an unlocked `@effect/platform-node-shared` still floats to the
next rc and breaks at import. Pin the whole set.

| what resolves                                                 | what happens                                           |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| Alchemy 77 + `effect` → rc.115 (measured 2026-09-16)          | `TypeError: Config.string is not a function` at import |
| `@effect/platform-node-shared` newer than the pinned `effect` | `Cannot find module 'effect/ByteSize'`                 |
| `rolldown` → 1.2.9 via vite's `~1.2.6` (measured 2026-09-16)  | `GET …/rolldown-1.2.9.tgz - 404` at `bun add`          |
| no `mime` (measured 2026-09-17 against Alchemy 78)            | `Cannot find package 'mime'` from cloudflare-runtime   |

Alchemy 78 adapted to rc.115 — that first row is why we used to pin 112, not a reason to
stay there. The override is still the only thing that holds the set together.

⚠️ `@effect/platform-node` is **required, not optional**: Alchemy's module graph reaches
`Cloudflare/Workers/WorkerBridge → @effect/platform-node/NodeServices` even when you only
import the Proxmox subpath.

⚠️ So is `mime`. Alchemy 78's `@alchemy.run/cloudflare-runtime` imported it without
declaring it (measured 2026-09-17). 79 declares it; the peer stays so a consumer
that followed the 78 README does not drop a required line.

⚠️ So is `cloudflare`. It was marked optional in 0.1.1, which claimed the `/cloudflare`
subpath would degrade without it — measured 2026-09-16, the subpath does not load at all:
`Cannot find package 'cloudflare'`. An optional peer should mean a feature is absent, not
that an import fails.
