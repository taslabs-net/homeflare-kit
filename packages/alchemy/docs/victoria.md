# Victoria binaries — `@homeflare/alchemy/victoria`

Status: active
Verified: 2026-09-22

`Victoria.Binary` installs one VictoriaMetrics-family binary from the vendor's
own release archive, verified against digests pinned in this package. It exists
to replace the Nix-built `victoria-metrics`, `victoria-logs`, `victoria-traces`,
`vmagent` and `vmalert`: all five Nix builds link a `/nix/store` `libresolv`, so
none of them survive Nix being removed.

⛔ **It installs; it never starts.** No `launchctl`, no `systemctl`, no restart.
The daemon is the stack's own `LaunchdJob` (or systemd unit), and it puts the
binary's `path` in its argv.

## Declaring one

```ts
import { HostDirectory, linuxProviders } from '@homeflare/alchemy/linux';
import { LaunchdJob, launchdProviders, localRunner } from '@homeflare/alchemy/launchd';
import { VictoriaBinary, victoriaDirectory, victoriaProviders } from '@homeflare/alchemy/victoria';

const runner = localRunner();
// providers: Layer.mergeAll(launchdProviders(runner), linuxProviders(runner), victoriaProviders(runner))

const dir = yield* HostDirectory('vmutils-1.151.0', {
  path: victoriaDirectory('/opt/example/bin', 'vmutils', '1.151.0'),
  mode: 0o755, owner: 0, group: 0,
});
const vmalert = yield* VictoriaBinary('vmalert', {
  directory: dir.path, // ★ an Output: the engine creates the directory first
  package: 'vmutils', version: '1.151.0', platform: 'darwin-arm64', binary: 'vmalert',
  owner: 0, group: 0, mode: 0o555,
});
yield* LaunchdJob('vmalert', { programArguments: [vmalert.path, '--httpListenAddr=127.0.0.1:8880'], … });
```

- **The directory is yours.** It must exist, and its last segment must be
  `<package>-<version>`: each version gets its own directory, so an upgrade is a
  new path — a create-before-delete replace, never an overwrite under a running
  daemon — and a rollback is a path. `HostDirectory` lives in the linux subpath
  but is plain `mkdir`/`rmdir` (⚠️ its macOS behaviour is reasoned, not
  measured — see the limits).
- **The job references `vmalert.path`**, not a string it built. That Output is
  what orders the job after the binary, and a version bump moves the path, so
  the plist changes and the job restarts on the new binary before the old one is
  deleted.
- **Declare each path once.** vmalert-logs is vmalert with other flags: one
  `VictoriaBinary`, referenced by both jobs.
- **Installed names drop the vendor's `-prod`.** Archive member `vmalert-prod` is
  written as `vmalert`, so argv[0], `ps` and `pgrep` names match the builds this
  replaces. The catalog writes the map out; nothing derives it.
- **Nothing estate-specific is in the kit.** Root, owner, group and mode are your
  props. The catalog holds vendor facts only.
- **One runner for all of it** — pass the same `HostRunner` to
  `victoriaProviders()` as to the jobs. There is no default: a binary goes
  wherever the runner reaches. It provides its own `FetchHttpClient.layer`.

## What reconcile does, in order

1. **Validate against the catalog** — before any host or network call.
2. **Check the directory exists** (and is not a symlink) — before any download.
3. **Observe the path.** A symlink or directory there is refused. A file this
   resource does not own is refused without `--adopt`. A file already holding
   the pinned bytes, mode and owner is done: no download, no write. ⚠️ At plan
   the probe calls even that file `Unowned`; at apply, when a prop was an Output
   and the probe never ran, it is accepted as the resume of an interrupted
   install — Host.File's rule (`file-converge.ts`).
4. **Download** the archive by its exact URL, into memory, never past its pinned
   size. Two binaries from one archive at once share one download.
5. **Verify the archive** against its pinned SHA-256 — before unpacking a byte.
6. **Unpack only the declared member**, streaming; the tar reader refuses the
   whole archive for any unsafe entry, declared or not.
7. **Verify the member** against its own pinned SHA-256.
8. **Write** through `HostRunner.writeFileAtomic` — the one writer every file
   resource uses (`launchd/file-converge.ts`): temp file in the same directory,
   mode and owner set, rename. Under `sudoRunner`, one staged `install -S`.
9. **Read back** and compare; a create that does not read back is removed.

A binary with the right bytes but the wrong mode or owner is re-written from
the bytes already on disk, re-hashed — no download.

## Trust — why the digests are pinned in code

The pins in `src/victoria/catalog.ts` are copied from each archive's
`_checksums.txt`, with the file's URL, its own digest and the date.

★ **Pinned, not fetched at apply.** The checksum file comes from the same
account, release and channel as the archive, and these releases are mutable
(`"immutable": false`). Whoever can swap an archive can swap its checksum file,
and a provider that trusts what it fetches would call the swap verified. A pin
moves only through a reviewed kit release, so a swapped asset is a refusal. And
a plan knows exactly which bytes it will install without the network.

⚠️ **The trust root is the GitHub release over TLS.** VictoriaMetrics publishes
no signature, cosign bundle, SLSA provenance or GitHub attestation for these
archives. A checksum proves integrity, not authorship. Your own `sha256` prop is
an optional second witness: the plan refuses unless it equals the catalog pin.

★ **What CI proves without a network** (`catalog.test.ts`): the four checksum
files sit in `src/victoria/fixtures/` byte-for-byte; each one's SHA-256 equals
GitHub's digest of that asset; the strict parser reads them; the catalog equals
what it reads; every catalog URL is in the measured asset list and none is an
`-enterprise`, `-cluster` or `vlutils` sibling.

## Refusals

Before anything is touched (plan time whenever the props are resolved): a
package, version, platform or binary the catalog does not pin — including
`v1.151.0`, `1.151.0-enterprise`, `victoria-metrics-cluster` and `vmalert-prod`;
a directory that is not absolute and normalised, or does not end in
`/<package>-<version>`; a mode that is setuid/setgid/sticky, group- or
world-writable, or not owner-executable; a `sha256` that is malformed or not the
catalog pin; an owner or group that is not a valid name or id.

At apply, before the download: a missing directory, or one that is a symlink; a
symlink or directory at the path; a file the resource does not own (without
`--adopt`); a chown without root.

From the vendor: a status other than 200; a body past or short of the pinned
size; an archive whose SHA-256 is not the pin; an archive entry that is
absolute, has a `..` segment, is a hard link, symlink, directory, device, FIFO
or contiguous file, is a GNU long-name or PAX header, is named twice, fails its
header checksum, uses base-256, is neither ustar nor GNU, a lone zero block, data
after the end, a truncated archive; the declared member missing; the member's
SHA-256 not its pin. Every one of these ends `Nothing was written.`

After the write: a file that does not read back as declared (the create is
removed). Errors are typed (`BinaryRefused`, `DownloadFailed`,
`ChecksumMismatch`, `ArchiveRefused`) and carry the house refusal sentence.

## Adding a version

Walk it down from the vendor, never from memory:

1. `gh api repos/VictoriaMetrics/<Repo>/releases/tags/v<version>` — the exact
   asset names, sizes and `digest`s, and `immutable`.
2. Fetch `<package>-<platform>-v<version>_checksums.txt`; its SHA-256 must equal
   GitHub's digest of it, and its first line must equal the archive's digest.
3. Stream the archive through `tar -tvzf -` (nothing saved): root-level
   regular files named `<binary>-prod`, nothing else.
4. Add the entry, commit the checksum file under `fixtures/`, add its name
   to `darwin-arm64-assets.txt` — `catalog.test.ts` then holds the pins to it.
5. Re-check attestations with a positive control, so a 404 means something:
   `gh api repos/VictoriaMetrics/<Repo>/attestations/sha256:<digest>` next to a
   repo known to publish them.

⛔ Never `latest`, never sort by publish date: VictoriaLogs v1.51.1 was
published after v1.52.0, and VictoriaMetrics interleaves LTS lines.

Measurements and limits: [victoria-measured.md](./victoria-measured.md).
What alchemy-run/alchemy would need to accept this: [victoria-upstream.md](./victoria-upstream.md).
