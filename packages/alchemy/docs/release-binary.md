# Release binaries — `@homeflare/alchemy/release`

Status: active
Verified: 2026-09-22

`Release.Binary` (`ReleaseBinary`) installs one binary out of a pinned release
archive, verified twice: the archive against its pinned SHA-256 before anything
is unpacked, then the binary against its own before it is written. The pinned
archive is **props**. Each vendor's pinned versions are **data** kept beside
the resource, and `VICTORIA_RELEASES` is the first data set. It exists to
replace the Nix-built Victoria binaries on the Mac host: all five Nix builds
link a `/nix/store` `libresolv`, and the vendor builds link none.

⛔ **It installs; it never starts.** No `launchctl`, no `systemctl`, no restart.
The daemon is the stack's own `LaunchdJob` (or systemd unit), and it puts the
binary's `path` in its argv.

## Declaring one

```ts
import { HostDirectory, linuxProviders } from '@homeflare/alchemy/linux';
import { LaunchdJob, launchdProviders, localRunner } from '@homeflare/alchemy/launchd';
import {
  ReleaseBinary, VICTORIA_RELEASES, catalogBinary, catalogDirectory, releaseProviders,
} from '@homeflare/alchemy/release';

const runner = localRunner();
// providers: Layer.mergeAll(launchdProviders(runner), linuxProviders(runner), releaseProviders(runner))

const vmalertOf = { package: 'vmutils', version: '1.151.0', platform: 'darwin-arm64', binary: 'vmalert' };
const dir = yield* HostDirectory('vmutils-1.151.0', {
  path: catalogDirectory('/opt/example/bin', vmalertOf), // …/vmutils-1.151.0
  mode: 0o755, owner: 0, group: 0,
});
const vmalert = yield* ReleaseBinary('vmalert', {
  ...catalogBinary(VICTORIA_RELEASES, vmalertOf), // archive, member, sha256, name
  directory: dir.path, // ★ an Output: the engine creates the directory first
  owner: 0, group: 0, mode: 0o555,
});
yield* LaunchdJob('vmalert', { programArguments: [vmalert.path, '--httpListenAddr=127.0.0.1:8880'], … });
```

- **`catalogBinary()` runs in your stack program.** A version, package,
  platform or binary the data set does not pin throws `BinaryRefused` there,
  so `alchemy plan` fails before any resource is asked anything
  (`plan.test.ts`: zero requests, zero host calls).
- **The directory is yours, one per version.** It must exist.
  `catalogDirectory(root, …)` names it `<root>/<package>-<version>`. A version
  bump is then a new path. Measured through the engine (`plan.test.ts`):
  mkdir new, download, write new, remove old, rmdir old, in that order.
- ⛔ **A new pin at the same path is refused**, at plan when the path is
  resolved and at apply otherwise, rather than overwriting a binary under the
  daemon that runs it. 🔴 While the directory is still an Output, a re-pin of
  the same bytes is planned as an `update`, never a `replace`: measured through
  the engine, a `replace` onto an unmoved path took the identical file as the
  new generation's, then deleted it with the old one, and reported success.
- **The job references `vmalert.path`**, not a string it built. That Output
  orders the job after the binary. A version bump moves the path, so the plist
  changes and the job restarts on the new binary before the old one is deleted.
- **Declare each path once.** vmalert-logs is vmalert with other flags: one
  `ReleaseBinary`, referenced by both jobs.
- **One logical id per binary, one per versioned directory.** `plan.test.ts`
  declares `ReleaseBinary('vmalert')` and `HostDirectory('vmutils-<version>')`:
  a bump plans the binary as a `replace`, the new directory as a `create` and
  the old one as a `delete`, and the engine removes the old binary before its
  directory.
- **Nothing estate-specific is in the kit.** Root, owner, group and mode are
  your props. The data sets hold vendor facts only.
- **One runner for all of it.** Pass the same `HostRunner` to
  `releaseProviders()` as to the jobs. There is no default: a binary goes
  wherever the runner reaches. It provides its own `FetchHttpClient.layer`.
- **Your own pins work too.** The props are plain data, so a stack may write
  them itself. ⛔ They must be plain values in the stack program: a pin wired
  from another resource's Output (a checksum file read at apply) is refused,
  on a first deploy too (`apply-pins.test.ts`). ⚠️ A stack program that
  fetches the file itself and passes plain strings cannot be told apart from
  a reviewed pin; `catalogBinary()` over a reviewed data set is the path
  that keeps them reviewed.

## What reconcile does, in order

1. **Validate every prop**, before any host or network call. Every pin must be a
   plain, well-formed value, as the stack program DECLARED it: by now an Output
   has resolved to a plausible string (`declared-pins.ts`).
2. **Check the directory exists** and is not a symlink, before any download.
3. **Observe the path.** A symlink or directory there is refused. A file this
   resource does not own is refused without `--adopt`. A file already holding
   the pinned bytes, mode and owner is done: no download, no write. ⚠️ At plan
   the probe calls even that file `Unowned`. At apply, when a prop was an Output
   and the probe never ran, it is accepted as the resume of an interrupted
   install. That is Host.File's rule (`file-converge.ts`).
4. **Download** `https://github.com/<repo>/releases/download/<tag>/<asset>`,
   into memory, never past the pinned size. Two binaries from one archive at
   once share one download.
5. **Verify the archive** against its pinned SHA-256, before unpacking a byte.
6. **Unpack only the declared member**, streaming. The tar reader refuses the
   whole archive for any unsafe entry, declared or not.
7. **Verify the member** against its own pinned SHA-256.
8. **Write** through `HostRunner.writeFileAtomic`, the one writer every file
   resource uses: a temp file in the same directory, mode and owner set, then
   rename. Under `sudoRunner`, one staged `install -S`.
9. **Read back** and compare. A create that does not read back is removed.

A binary with the right bytes but the wrong mode or owner is re-written from
the bytes already on disk, re-hashed, without a download.

## Trust: why the digests are pinned in code

★ **Pinned, not fetched at apply.** A checksum file comes from the same
account, release and channel as the archive, and every release checked so far
is mutable (`"immutable": false`). Whoever can swap an archive can swap its
checksum file, and a provider that trusts what it fetches would call the swap
verified. A pin moves only through a reviewed change, so a swapped asset is a
refusal. And a plan knows exactly which bytes it will install without the
network. Each data-set entry records the checksum file's URL, its own SHA-256
and the date the pins were copied.

⚠️ **The trust root.** At apply it is the pins alone: TLS, GitHub's redirect,
its CDN or a proxy can make a download fail, never make other bytes pass. The
pins rest on one read of the GitHub release over TLS on the `recorded` date
(trust on first use), checked against GitHub's own asset `digest`, then on
review of that commit and the kit release the stack's lockfile resolves.
VictoriaMetrics publishes no signature, cosign bundle, SLSA provenance or
GitHub attestation for these archives: a checksum proves integrity, not
authorship.

★ **What CI proves without a network** (`victoria.test.ts`) is consistency,
not provenance: each committed checksum file in `src/release/fixtures/victoria/`
hashes to the digest the data set records for it; the strict parser reads
them; the data set equals what it reads; every asset is in the committed
listing, and none is an `-enterprise`, `-cluster` or `vlutils` sibling.
⚠️ That those recorded digests are GitHub's was measured once, not by CI. A
change that edits a fixture and its pins together passes; review is the gate.

## Refusals

In the stack program (`catalogBinary`): a package, version, platform or
binary the data set does not pin, including `v1.151.0`, `1.151.0-enterprise`,
`victoria-metrics-cluster`, `vmalert-prod` and inherited keys like
`constructor`.

At plan (the probe and `diff`), before anything is touched: a pin that is
missing or not a plain value (an Output pin would be a fetch; a first deploy is
never diffed, so reconcile refuses it there, before any host call, from the
props as declared); a repo that is not `owner/name`, or whose name is `.` or
`..`; a tag, asset or
name that is not one safe path segment; an asset that is not a `.tar.gz` or
`.tgz` (a glob is not a name); a size that is not an integer from 1 byte to
1 GiB (it is allocated up front); a digest that is not 64 lower-case hex; a
member that is absolute or climbs. Also a relative or unnormalised directory; a
mode that is setuid, setgid, sticky, group- or world-writable, or not
owner-executable; an owner or group that is not a valid name or id; a new pin
at the same path.

At apply, before the download: a missing directory, or one that is a symlink; a
symlink or directory at the path; a file the resource does not own (without
`--adopt`); a chown without root.

From the vendor: a status other than 200; a body past or short of the pinned
size; an archive whose SHA-256 is not the pin; an archive entry that is
absolute, has a `..` segment, is a hard link, symlink, directory, device, FIFO
or contiguous file, is a GNU long-name or PAX header, is named twice, fails its
header checksum, uses base-256, is neither ustar nor GNU, a lone zero block,
data after the end, a truncated archive; the declared member missing; the
member's SHA-256 not its pin. Every one of these ends `Nothing was written.`

After the write: a file that does not read back as declared (a create is
removed). Errors are typed (`BinaryRefused`, `DownloadFailed`,
`ChecksumMismatch`, `ArchiveRefused`) and carry the house refusal sentence.

Data sets and adding a vendor: [release-binary-catalogs.md](./release-binary-catalogs.md).
Measurements and limits: [release-binary-measured.md](./release-binary-measured.md).
What alchemy-run/alchemy would need: [release-binary-upstream.md](./release-binary-upstream.md).
