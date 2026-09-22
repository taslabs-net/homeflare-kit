/**
 * The VictoriaMetrics release archives Victoria.Binary may install — vendor facts only, every one
 * copied from the vendor's own checksum file for that archive and cross-checked against GitHub's
 * asset digest. Nothing here names a host, a path, a user or an estate.
 *
 * ★ PINNED IN CODE, NOT FETCHED AT APPLY. The checksum file is published by the same account, on
 *   the same release, over the same channel as the archive it describes — and these releases are
 *   MUTABLE (`"immutable": false` on v1.151.0, v1.52.0 and v0.10.0, measured 2026-09-22; the
 *   vendor's own release Makefile says to delete an asset in the UI to re-upload it). Whoever can
 *   swap an archive can swap its checksum file in the same minute, and a provider that trusts
 *   whatever checksum file it finds would install the new bytes and call them verified. A pin
 *   committed here changes only through a reviewed kit release, so a swapped asset is a REFUSAL
 *   that names the digest it expected. It also means an apply makes one request, not two, and a
 *   plan knows exactly which bytes it will install without touching the network.
 * ⚠️ TRUST ROOT: THE GITHUB RELEASE OVER TLS, uploaded from a maintainer's personal account.
 *   VictoriaMetrics publishes no signature, cosign bundle, SLSA provenance or GitHub artifact
 *   attestation for these archives (measured 2026-09-22: no .sig/.asc/.pem/.bundle assets; the
 *   attestations API answers 404 for all four digests, next to a positive control that answers
 *   200). A checksum file proves the download is not corrupt — integrity — not who built it.
 * ⛔ A NEW VERSION IS A NEW ENTRY, WALKED DOWN THE SAME WAY — docs/victoria.md "Adding a version".
 *   Never `latest`, never sorted by publish date: VictoriaLogs v1.51.1 was published AFTER v1.52.0.
 * ⛔ EXACT NAMES. `-enterprise`, `-cluster` and `-enterprise-cluster` archives sit beside each of
 *   these with every prefix in common, so each asset name below is written out whole — never
 *   composed from a package and a version, which is how a template drifts onto a sibling.
 */

/** An archive the catalog lists. ★ The vendor's own package names, one archive each. */
export type VictoriaPackage = 'victoria-metrics' | 'victoria-logs' | 'victoria-traces' | 'vmutils';

/** An OS and CPU pair the vendor builds for, in the vendor's spelling inside the asset name. */
export type VictoriaPlatform = 'darwin-arm64';

/** One release archive, exactly as the vendor published it. */
export type PinnedArchive = {
  /** The release-asset URL, whole. ⛔ Never a prefix or a pattern. */
  readonly url: string;
  /** Bytes, per the release API. A download that runs past this is cut off and refused. */
  readonly size: number;
  /** The archive's line in the checksum file; equal to GitHub's asset `digest` when recorded. */
  readonly sha256: string;
  /** Archive member → its line in the checksum file. Every member the vendor file lists. */
  readonly members: Readonly<Record<string, string>>;
  /** The checksum file every digest above was copied from, its own digest, and when. */
  readonly checksums: { readonly url: string; readonly sha256: string; readonly recorded: string };
};

export type VictoriaPackageEntry = {
  /**
   * Installed name → archive member. ★ THE VENDOR'S `-prod` SUFFIX IS DROPPED ON PURPOSE: every
   *   member is named `<binary>-prod`, and installing it as `<binary>` keeps a launchd job's argv[0],
   *   `ps` and `pgrep` names identical to the builds it replaces. Written out, never derived, so a
   *   member the vendor adds is installable only once somebody names it here.
   */
  readonly binaries: Readonly<Record<string, string>>;
  /** Version (no `v`) → platform → archive. */
  readonly versions: Readonly<
    Record<string, Readonly<Partial<Record<VictoriaPlatform, PinnedArchive>>>>
  >;
};

export type VictoriaCatalog = Readonly<Record<VictoriaPackage, VictoriaPackageEntry>>;

const RECORDED = '2026-09-22';
const GITHUB = 'https://github.com/VictoriaMetrics';

export const VICTORIA_CATALOG: VictoriaCatalog = {
  'victoria-logs': {
    binaries: { 'victoria-logs': 'victoria-logs-prod' },
    versions: {
      '1.52.0': {
        'darwin-arm64': {
          checksums: {
            recorded: RECORDED,
            sha256: 'd4ca686c3cceec78a0f4e733ef9ab3f857549131ea48cd6f89f701cda406ac4b',
            url: `${GITHUB}/VictoriaLogs/releases/download/v1.52.0/victoria-logs-darwin-arm64-v1.52.0_checksums.txt`,
          },
          members: {
            'victoria-logs-prod':
              '9e48809e314902782959b3a4e683a3087476759d0293791a0564921c676ca7be',
          },
          sha256: '3157d4b6181d8a7e3e30918e2cbfcd4cc4cb66263e3ef21ea91e4f20f8980883',
          size: 10_943_697,
          url: `${GITHUB}/VictoriaLogs/releases/download/v1.52.0/victoria-logs-darwin-arm64-v1.52.0.tar.gz`,
        },
      },
    },
  },
  'victoria-metrics': {
    // ⛔ The SINGLE-NODE archive. `…-cluster.tar.gz` holds vminsert/vmselect/vmstorage instead.
    binaries: { 'victoria-metrics': 'victoria-metrics-prod' },
    versions: {
      '1.151.0': {
        'darwin-arm64': {
          checksums: {
            recorded: RECORDED,
            sha256: '735745ee0e7b2d5b8118883f2d0ed124c2a12d70261c16380128f5e362566d1e',
            url: `${GITHUB}/VictoriaMetrics/releases/download/v1.151.0/victoria-metrics-darwin-arm64-v1.151.0_checksums.txt`,
          },
          members: {
            'victoria-metrics-prod':
              '3c493a95ac1e9034a3261b230c4d62f3b186a04aafcdbacc99bfc110dc5de6a1',
          },
          sha256: '8792437c4c0b63719fed7b44ad18d4b4167bbe6861ab3e84c7bb010c922e7582',
          size: 12_739_105,
          url: `${GITHUB}/VictoriaMetrics/releases/download/v1.151.0/victoria-metrics-darwin-arm64-v1.151.0.tar.gz`,
        },
      },
    },
  },
  'victoria-traces': {
    binaries: { 'victoria-traces': 'victoria-traces-prod' },
    versions: {
      '0.10.0': {
        'darwin-arm64': {
          checksums: {
            recorded: RECORDED,
            sha256: 'cd32bfc21900b48ba543124e43827a1d13d735e45d50dbfd742c0ca6640e1aae',
            url: `${GITHUB}/VictoriaTraces/releases/download/v0.10.0/victoria-traces-darwin-arm64-v0.10.0_checksums.txt`,
          },
          members: {
            'victoria-traces-prod':
              '4759ec89a466129b9eefc22244a111e1f489739340747805fd93b58fd0f7b2dd',
          },
          sha256: 'cbe83f1d409cbb85fbf1c890c4a9b7fd34c1d74acec4dce2e0ebe46fcb260e38',
          size: 11_126_077,
          url: `${GITHUB}/VictoriaTraces/releases/download/v0.10.0/victoria-traces-darwin-arm64-v0.10.0.tar.gz`,
        },
      },
    },
  },
  vmutils: {
    // ★ ONE ARCHIVE, SEVEN TOOLS (measured: 264 MB unpacked). Only a declared member is extracted.
    //   vmalert-logs is not a tool of its own: it is vmalert run with `--rule.defaultRuleType=vlogs`.
    binaries: {
      vmagent: 'vmagent-prod',
      vmalert: 'vmalert-prod',
      'vmalert-tool': 'vmalert-tool-prod',
      vmauth: 'vmauth-prod',
      vmbackup: 'vmbackup-prod',
      vmctl: 'vmctl-prod',
      vmrestore: 'vmrestore-prod',
    },
    versions: {
      '1.151.0': {
        'darwin-arm64': {
          checksums: {
            recorded: RECORDED,
            sha256: 'fda5a64fce9022bee7614c3fda27271c0826f1d7b90f8b162e1f48c77c0df04b',
            url: `${GITHUB}/VictoriaMetrics/releases/download/v1.151.0/vmutils-darwin-arm64-v1.151.0_checksums.txt`,
          },
          members: {
            'vmagent-prod': 'd3b6fa1f71ef48beac619f15f8adfa7610e76605caf37db1ebfbb379b6692329',
            'vmalert-prod': '62845795167e9ff47890e83ac4ac5934693c105767db88591c95a08f3c4fb354',
            'vmalert-tool-prod': 'cbffb9495e4bb1457c9d45e0a7064b3a3a29b2cfd1ae24bfe8f00ec327c26998',
            // ⚠️ gitleaks' generic-api-key rule reads this one public digest as a key (its entropy;
            //   measured 2026-09-22). It is the vendor's published SHA-256 of vmauth-prod.
            'vmauth-prod': '398df9e0f5b7035d037e39ee9ff66a10ddde5333d832602463aa4d2865fdb508', // gitleaks:allow
            'vmbackup-prod': '1974a2ee211b49bf581287808e010846f6c47ff135276214c6da628567777b9e',
            'vmctl-prod': '998b111eee206b98e6d25fdf2fbaa455ecc17c7f9e7c3b2373e127cef762459f',
            'vmrestore-prod': 'fc824df7215b01b57921ed46afde7fea6b6698adf13d9ea8e3fe36e194ef8190',
          },
          sha256: '27d68bac90e28929214091ed9d27f2e9fef25a080407e2c8661ea9b52dd6b183',
          size: 123_584_800,
          url: `${GITHUB}/VictoriaMetrics/releases/download/v1.151.0/vmutils-darwin-arm64-v1.151.0.tar.gz`,
        },
      },
    },
  },
};
