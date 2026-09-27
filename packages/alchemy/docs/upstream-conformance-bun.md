# The Bun line

Status: extracted from the [conformance ledger](./upstream-conformance.md); its dated
measurements and open findings are preserved below.

These are non-test files under `src/` that the standard (S42) says must be portable. "Exp"
marks files exported from a subpath `index.ts`. `git grep` on `origin/main` finds 23 non-test
files under `src/` that call `Bun.*` or import `node:*`/`bun:*`. Six of them are outside
S42's scope:

- four loopback fakes (`caddy/fake-caddy.ts`, `openbao/fake-bao.ts`, `proxmox/fake-pve.ts`,
  `proxmox/fake-pve-lxc.ts`), which are test-side under S44;
- `proxmox/provision-cli-fake.ts`, which is used only by tests;
- `verify/args.ts`, which belongs to the CLI and so is tooling under S43.

That leaves 17 files. The table lists them, plus `provision-cli-fake.ts`, which should move
out of `src/`. The six out-of-scope files still ship in the tarball's `src/`, but no export
reaches them.
⚠️ The first version of this table said 16 files and left out `launchd/job-form.ts`.
⚠️ Corrected 2026-09-22: 14 of the 17 break upstream's rule. `launchd/job-form.ts`,
`proxmox/write-only.ts` and `proxmox/pbs-notification-target-wire.ts` use only synchronous
`node:crypto` or `Buffer`. Upstream allows those inside `Effect.sync`
(`AGENTS.md@v2.0.0-beta.79#Workflow`), and 40 upstream `src/` files import `node:crypto`,
among them `Fly/Secret.ts` and `Railway/Variable.ts`. They were listed under a blanket
`node:*` ban that upstream does not have.

| file                                                       | API                                          | exp | portable replacement                         |
| ---------------------------------------------------------- | -------------------------------------------- | --- | -------------------------------------------- |
| `openbao/cloudflare-roles-config.ts`                       | `Bun.YAML`                                   | yes | parse on the tooling side; pass data in      |
| `openbao/digest.ts` (14 importers)                         | `Bun.CryptoHasher`                           | —   | `Crypto.digest` + hex; keep `canonical()` ⚠️ |
| `openbao/cloudflare-parity-snapshot.ts`                    | `Bun.file`, `Bun.Glob`                       | —   | `FileSystem` + `Path`                        |
| `openbao/approle-login-form.ts`                            | `Bun.file`                                   | —   | `FileSystem.readFileString`                  |
| `openbao/approle-login-result.ts`                          | `Bun.inspect`                                | —   | a plain formatter                            |
| `openbao/forgejo-bootstrap.ts`                             | `Bun.spawn`                                  | —   | unreferenced; `ChildProcessSpawner` or drop  |
| `talos/credentials.ts`                                     | `Bun.write/file/env/randomUUIDv7`, `node:fs` | —   | `FileSystem.makeTempFileScoped`              |
| `talos/kubeconfig.ts`                                      | `Bun.file`                                   | yes | `FileSystem`                                 |
| `talos/talos-machine-config.ts`                            | `Bun.file`                                   | yes | `FileSystem`                                 |
| `talos/values.ts`                                          | `Bun.YAML`, `node:crypto`                    | —   | tooling-side parse; hash may stay            |
| `launchd/local-runner.ts`                                  | `node:child_process`, `node:fs/promises`     | yes | H3 above                                     |
| `launchd/sudo-stage.ts`                                    | `node:fs/promises`, `node:os`, `node:path`   | —   | `FileSystem`, `Path`                         |
| `launchd/job-form.ts`                                      | `node:crypto` (`createHash`)                 | —   | allowed in `Effect.sync`                     |
| `linux/ssh-runner.ts`                                      | `node:child_process`, `node:crypto`          | yes | H3 above                                     |
| `caddy/caddy-http-client.ts`                               | `node:http`, `node:stream` (unix socket)     | yes | inherent — an Effect `HttpClient`, not H3 ⚠️ |
| `proxmox/write-only.ts`, `pbs-notification-target-wire.ts` | `node:crypto`, `node:buffer`                 | —   | allowed in `Effect.sync` ⚠️                  |
| `proxmox/provision-cli-fake.ts`                            | `Bun.spawn`, `node:fs`                       | —   | test-only; move out of `src/`                |

The ⚠️ rows:

- `openbao/digest.ts`: every `Bao.*` family persists this digest in state, so a swap must
  hash the same bytes (`canonical()`, lowercase hex), or every row plans an update.
  `Crypto.digest` from `effect/Crypto` is in every stack's services and fails with a typed
  error; `alchemy/Util/sha256` wraps WebCrypto in `Effect.promise`.
- `proxmox/write-only.ts`: a salted scrypt seal with `timingSafeEqual`. No Alchemy helper
  replaces it. A plain `sha256` would make a write-only secret cheap to brute-force from
  state, and it would change the persisted seal format.
- `caddy/caddy-http-client.ts`: unlike `launchd/local-runner.ts` and `linux/ssh-runner.ts`
  (H3, plain `async` interfaces), this is already the Effect `HttpClient.HttpClient` the
  distilled SDK's own protocol runs on — `node:http` here is the same kind of unavoidable,
  bottom-of-the-stack platform adapter `@effect/platform-node`'s own `NodeHttpClient.ts` is,
  extended with `socketPath` dialing (that module has none) because a unix socket is the
  measured transport a local Caddy needs and neither `FetchHttpClient` (Bun-only `unix`
  option) nor stock `NodeHttpClient` (URL-only) speaks one on both Bun and Node. There is no
  more-portable replacement to point to; the file already conforms to S19 (no async/await,
  no raw `Promise` — `Effect.callback`/`Effect.tryPromise` throughout).

Test runners: 51 files import `node:test`/`node:assert` (openbao 42, proxmox 7, forgejo 1,
talos 1), and 126 import `bun:test`. S43 says `bun:test`.
