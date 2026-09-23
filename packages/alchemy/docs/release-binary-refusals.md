# Release binaries — every refusal

Status: active
Verified: 2026-09-22

Everything `Release.Binary` refuses, by where it is refused. The guide is
[release-binary.md](./release-binary.md). ★ One page per subject: the guide says
what a declaration does, this says what stops it, and a new refusal lands here.

In the stack program (`catalogBinary`): a package, version, platform or
binary the data set does not pin, including `v1.151.0`, `1.151.0-enterprise`,
`victoria-metrics-cluster`, `vmalert-prod` and inherited keys like
`constructor`.

At plan (the probe and `diff`), before anything is touched: a pin that is
missing or not a plain value (an Output pin would be a fetch; a first deploy
is never diffed, so reconcile refuses it there, before any host call, from the
props as declared); a repo that is not `owner/name`, or whose name is `.` or
`..`; a tag, asset or name that is not one safe path segment; an asset that is
not a `.tar.gz` or `.tgz` (a glob is not a name); a size that is not an
integer from 1 byte to 1 GiB (it is allocated up front); a digest that is not
64 lower-case hex; a member that is absolute or climbs. Also a relative or
unnormalised directory; a mode that is setuid, setgid, sticky, group- or
world-writable, or not owner-readable and owner-executable; an owner or group
that is not a valid name or id; a new pin at the same path.

⚠️ **Not on a first deploy with `directory: dir.path`.** Alchemy neither
probes nor diffs a create whose props hold an Output, so there every check
above runs at apply, after `HostDirectory` has made the directory (measured: a
group-writable mode planned `create`, then the apply ran `mkdir` and refused).
Nothing is written to the binary's path. A failed first install never bricks
the next plan: the recovery read of its row answers "nothing recovered"
(`binary-read.ts`).

At plan, only under `--adopt` (the probe then hands `diff` what it read): a
file at the path that is not the pinned binary, or not a regular file.

At apply, before the download: a second resource installing the same path in
one deploy (two jobs that run one binary share one `ReleaseBinary`; measured,
two owners meant dropping either deleted the other's file); a missing
directory, one that is a symlink, or one that group or other may write; a
symlink or directory at the path; a file the resource does not own (without
`--adopt`, even the pinned bytes; with it, anything but the pinned bytes); a
chown without root.

From the vendor: a status other than 200; a body past or short of the pinned
size; an archive whose SHA-256 is not the pin; an archive entry that is
absolute, has a `..` segment, is a hard link, symlink, directory, device, FIFO
or contiguous file, is a GNU long-name or PAX header, is named twice, fails its
header checksum, uses base-256, is neither ustar nor GNU, a lone zero block,
data after the end, a truncated archive; the declared member missing; the
member's SHA-256 not its pin. Every one of these ends `Nothing was written.`

After the write: a file that does not read back as declared (a create is
removed). Errors are tagged (`BinaryRefused`, `DownloadFailed`,
`ChecksumMismatch`, `ArchiveRefused`) and carry the house refusal sentence.
⚠️ Tagged, not typed: no caller can `catchTag` one yet (`error-channel.test.ts`).
