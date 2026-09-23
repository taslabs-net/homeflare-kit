# Release binaries — the OpenBao walk-down

Status: active
Verified: 2026-09-23

`OPENBAO_RELEASES` (`src/release/openbao.ts`) is the second data set, and the
first whose checksum file never lists its own binary. Every command below was
run 2026-09-23 against `openbao/openbao` v2.6.2, from this worktree, network
reads only — nothing executed the vendor binary.

## The release itself

```
gh api repos/openbao/openbao/releases/tags/v2.6.2
```

`published_at` 2026-08-18T16:21:00Z, `immutable: false`, 251 assets.
`openbao_2.6.2_darwin_arm64.tar.gz`: 76,833,570 bytes,
`digest: sha256:4e495376174accc0e014d31e9901f518a974f966850c839f626347eaac05fd52`.

## checksums.txt

```
curl -sL -o checksums.txt \
  https://github.com/openbao/openbao/releases/download/v2.6.2/checksums.txt
shasum -a 256 checksums.txt
```

8,683 bytes, `sha256 3d4a19fdc54a86fd94ce59ea91316dbf4304180bb27ae818e78e85c7f2164645`
— equal to GitHub's own `digest` for the asset. 83 lines, every one matching
`^[0-9a-f]{64}  [^\s/]+$` (`checksums.ts`'s parser), LF endings, a trailing
newline, no name repeated. Line 20 is the darwin_arm64 archive and equals the
release API's digest. **41 of the 83 lines are `.sbom.json`; the rest are
archives, `.deb` or `.rpm` — never `bao` itself**: `grep -n '  bao$'
checksums.txt` finds nothing. That is why the member digest is `computed`,
never `members` (checksums.ts's header explains the shape generally; this is
OpenBao's instance of it).

## The signature over checksums.txt

```
curl -sL -o checksums.txt.gpgsig \
  https://github.com/openbao/openbao/releases/download/v2.6.2/checksums.txt.gpgsig
curl -sL -o openbao-gpg-pub-20240618.asc \
  https://openbao.org/assets/openbao-gpg-pub-20240618.asc
gpg --dearmor -o openbao-pub.gpg openbao-gpg-pub-20240618.asc
gpgv --keyring ./openbao-pub.gpg checksums.txt.gpgsig checksums.txt
```

```
gpgv: Signature made Tue Aug 18 11:57:25 2026 EDT
gpgv:                using RSA key E617DCD4065C2AFC0B2CF7A7BA8BC08C0F691F94
gpgv: Good signature from "OpenBao <openbao@lists.lfedge.org>"
```

`gpg --show-keys --with-fingerprint` on the same file: primary
`66D1 5FDD 8728 7219 C8E1 5478 D200 CD70 2853 E6D0`, signing subkey
`E617 DCD4 065C 2AFC 0B2C F7A7 BA8B C08C 0F69 1F94` — both match OpenBao's own
`install.mdx` at this tag. `checksums.txt.gpgsig` is 566 bytes, sha256
`40f294d642a2b4e9adac766ca6b8b2633e15b3dbfdf63969dedbf46d94df53e8`; the key
file is 6,896 bytes, sha256
`1862a196422947124282e026ea4e09d6f7c5d383b628d90c17906936e6e5a8e0`.

⚠️ **Trust on first use, across two channels one project runs**: the release
asset (GitHub) and the key (openbao.org) are both OpenBao's own
infrastructure. A verified signature says the two agree, not that a third
party attests to either. `cosign` is not installed on the mini (`which
cosign` — not found), so the Sigstore bundle alongside `checksums.txt` was
read, not verified: its certificate names
`https://github.com/openbao/openbao/.github/workflows/release.yml@refs/heads/release/2.6.x`,
issuer `https://token.actions.githubusercontent.com` — recorded in
`openbao.ts` as an **unverified** identity. "GPG or Sigstore" is met by the
GPG half.

Attestations, for completeness: `gh api
repos/openbao/openbao/attestations/sha256:4e49…` → 404. Positive control
(`gh api repos/cli/cli/attestations/sha256:<its macOS_arm64 digest>`) → 200,
2 attestations, same day. A 404 here means "none published", not "the API is
down".

## The archive: download, hash, unpack

```
curl -sL -o openbao_2.6.2_darwin_arm64.tar.gz \
  https://github.com/openbao/openbao/releases/download/v2.6.2/openbao_2.6.2_darwin_arm64.tar.gz
shasum -a 256 openbao_2.6.2_darwin_arm64.tar.gz
tar -tvzf openbao_2.6.2_darwin_arm64.tar.gz
```

76,833,570 bytes, sha256
`4e495376174accc0e014d31e9901f518a974f966850c839f626347eaac05fd52` — equal to
the pin. `tar -tvzf` (full stream, nothing saved beyond the archive itself):
four root-level regular files, `ustar`, no PAX header, no directory entry —

```
-rw-r--r--  0 runner runner    131858 CHANGELOG.md
-rw-r--r--  0 runner runner     15958 LICENSE
-rw-r--r--  0 runner runner      7136 README.md
-rwxr-xr-x  0 root   root   193769394 bao
```

The kit's own `extractMembers` (`archive.ts`) read the same stream without
refusing it and returned the same four names, in the same order — the
previous partial-range read (`release-binary-catalogs.md`'s queue note) is
superseded by this full-stream one, so **no tar-reader change is needed for
this vendor**.

## The member digest — computed, not the vendor's

```
tar -xzOf openbao_2.6.2_darwin_arm64.tar.gz bao | shasum -a 256
```

`d476d17e81a35e6d70dd7e86a8ab2a3664313525118f1f1cfe0130e7a2b95f3a` — and the
kit's `extractMembers` over the same bytes produced the identical digest. Two
independent readers agree, which is what `computed` in `openbao.ts` records,
dated, next to a header explaining it is not a vendor fact.

## The extracted binary, never run

```
tar -xzf openbao_2.6.2_darwin_arm64.tar.gz bao
chmod -x bao   # never made executable in this worktree
otool -L bao
codesign -dv --verbose=2 bao
xattr -l bao
```

`otool -L`: `libSystem.B.dylib`, `libresolv.9.dylib`, CoreFoundation,
Security — all system frameworks, none from `/nix/store` — the same class as
Victoria's five. `codesign`: `flags=0x20002(adhoc,linker-signed)`, no
TeamIdentifier — a stock Go/macOS ad-hoc signature, same as the Victoria
binaries. `xattr -l`: `com.apple.provenance` only, no quarantine. Build
provenance (`goreleaser.other.yaml` at v2.6.2, read, not re-measured here):
`CGO_ENABLED=0`, tag `ui` — the same build class the darwin release ships for
every OpenBao platform.

Both scratch copies (`bao`, the `.tar.gz`) were deleted after these commands;
nothing was executed and nothing was written outside the scratch directory.

## What this does NOT establish

- **Sigstore identity is read, not cryptographically checked** — `cosign` was
  not run. Treat the workflow identity above as a claim, not a verification.
- **The agent never ran `bao`.** Whether it starts under launchd, and whether
  its approle auto-auth / template / exec behaviour matches the Nix build
  the vault server runs today, is unmeasured — expected to be unaffected
  (nothing here suggests otherwise), but nobody has watched it happen.
- **No adoption or install-path measurement.** This PR adds only the catalog
  entry, its tests and this record — no `ReleaseBinary` declaration, no
  consuming stack change.
