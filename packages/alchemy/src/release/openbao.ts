/**
 * OpenBao's release archives, pinned — the second data set for Release.Binary, walked down
 * 2026-09-23 (packages/alchemy/docs/release-binary-openbao.md has every command).
 *
 * ★ THE MEMBER DIGEST IS OURS, NOT THE VENDOR'S. `checksums.txt` lists 83 lines: every archive and
 *   every `.sbom.json`, never `bao` itself (measured 2026-09-23 — see checksums.ts's header on why
 *   that is normal for this vendor). So `bao`'s SHA-256 sits under `computed`, hashed from the one
 *   archive whose OWN SHA-256 already matched the checksums-file pin — never filed under `members`,
 *   which is vendor lines only.
 * ★ PLATFORM KEY IS THE VENDOR'S OWN SPELLING: `darwin_arm64`, underscore — OpenBao's asset names
 *   read `openbao_2.6.2_darwin_arm64.tar.gz`. Victoria's catalog spells the same idea
 *   `darwin-arm64`, hyphen, because THAT vendor's asset names use a hyphen. Nothing here picks one
 *   estate-wide convention; a consumer names the platform its data set actually uses. If a reviewer
 *   would rather the estate pick one spelling, that is a one-line change to this rule, not to any
 *   consumer, made in the same PR that adds the second spelling.
 * ★ GPG, MEASURED, TWO INDEPENDENT CHANNELS: `gpgv` against the dearmored key from openbao.org
 *   returned "Good signature from OpenBao <openbao@lists.lfedge.org>" over `checksums.txt` using
 *   subkey E617DCD4065C2AFC0B2CF7A7BA8BC08C0F691F94 of primary 66D15FDD87287219C8E15478D200CD702853E6D0
 *   (both fingerprints published in OpenBao's own install.mdx at this tag). ⚠️ TRUST ON FIRST USE
 *   ACROSS TWO CHANNELS ONE PROJECT RUNS: the release asset and openbao.org are both OpenBao's own
 *   infrastructure, so this is not a third party attesting to the key — it raises the bar over no
 *   check at all (a swap needs both channels, not one), it does not reach independent provenance.
 * ⛔ SIGSTORE WAS NOT CHECKED: `cosign` is not installed on the mini (measured 2026-09-23). The
 *   bundle's certificate SAN (read, not verified) names
 *   `https://github.com/openbao/openbao/.github/workflows/release.yml@refs/heads/release/2.6.x`,
 *   issuer `https://token.actions.githubusercontent.com` — recorded here as an UNVERIFIED identity,
 *   never as a passing check. "GPG or Sigstore" is met by the GPG half alone.
 * ⚠️ THE BUILD THIS PINS IS NOT THE ONE THE VAULT SERVER RUNS. Read from goreleaser.other.yaml at
 *   v2.6.2: `CGO_ENABLED=0`, build tag `ui`. Expected to differ from the Nix build in nothing an
 *   agent (approle auto-auth, templates, exec) depends on; nobody has run this binary to confirm —
 *   docs/release-binary-openbao.md says so and stops there, by house rule (never execute `bao`).
 */
import type { ReleaseCatalog } from './catalog.ts';

const RECORDED = '2026-09-23';
const REPO = 'openbao/openbao';
const TAG = 'v2.6.2';
const DOWNLOAD = `https://github.com/${REPO}/releases/download/${TAG}`;

export const OPENBAO_RELEASES: ReleaseCatalog = {
  packages: {
    openbao: {
      // ★ The member is named `bao` itself — no `-prod`-style suffix; the vendor tarball unpacks
      //   CHANGELOG.md, LICENSE, README.md and `bao` at its root (measured, full stream, 2026-09-23).
      binaries: { bao: 'bao' },
      versions: {
        '2.6.2': {
          darwin_arm64: {
            asset: 'openbao_2.6.2_darwin_arm64.tar.gz',
            checksums: {
              recorded: RECORDED,
              sha256: '3d4a19fdc54a86fd94ce59ea91316dbf4304180bb27ae818e78e85c7f2164645',
              signature: {
                kind: 'openpgp',
                key: {
                  fingerprint: '66D15FDD87287219C8E15478D200CD702853E6D0',
                  sha256: '1862a196422947124282e026ea4e09d6f7c5d383b628d90c17906936e6e5a8e0',
                  url: 'https://openbao.org/assets/openbao-gpg-pub-20240618.asc',
                },
                sha256: '40f294d642a2b4e9adac766ca6b8b2633e15b3dbfdf63969dedbf46d94df53e8',
                url: `${DOWNLOAD}/checksums.txt.gpgsig`,
                verified: RECORDED,
              },
              url: `${DOWNLOAD}/checksums.txt`,
            },
            // ★ NOT a vendor fact — see the header. Hashed from THIS archive after its own SHA-256
            //   (below) already matched the checksums.txt pin; confirmed two ways
            //   (extractMembers and `tar -xzOf … bao | shasum -a 256`) and against `tar -tvzf -`.
            computed: {
              bao: {
                recorded: RECORDED,
                sha256: 'd476d17e81a35e6d70dd7e86a8ab2a3664313525118f1f1cfe0130e7a2b95f3a',
              },
            },
            members: {},
            repo: REPO,
            sha256: '4e495376174accc0e014d31e9901f518a974f966850c839f626347eaac05fd52',
            size: 76_833_570,
            tag: TAG,
          },
        },
      },
    },
  },
  vendor: 'OpenBao',
};
