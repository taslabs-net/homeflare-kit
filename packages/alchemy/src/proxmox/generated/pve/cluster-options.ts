/**
 * Generated pve-manager API types for `/cluster/options` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (`--check` compares without writing)
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * ⚠️ A REQUEST PARAMETER IS TEXT ON THE WIRE. `client.ts` sends form encoding, so an integer is
 *   `\`${number}\`` and a boolean is `'0' | '1'` — the spellings that reach the server. The
 *   vendor's BOUNDS on those values are enforced separately, at plan time, from
 *   pve/../constraints (codegen/README.md). A response is JSON and is not spelled that way.
 */

/** GET /cluster/options — `data` payload after client unwrap. */
export type ClusterOptionsGetReturn = {
  'allowed-tags': readonly string[];
  bwlimit?: string;
  'consent-text'?: string;
  console?: 'applet' | 'vv' | 'html5' | 'xtermjs';
  crs?: string;
  description?: string;
  email_from?: string;
  fencing?: 'watchdog' | 'hardware' | 'both';
  ha?: string;
  http_proxy?: string;
  keyboard?:
    | 'de'
    | 'de-ch'
    | 'da'
    | 'en-gb'
    | 'en-us'
    | 'es'
    | 'fi'
    | 'fr'
    | 'fr-be'
    | 'fr-ca'
    | 'fr-ch'
    | 'hu'
    | 'is'
    | 'it'
    | 'ja'
    | 'lt'
    | 'mk'
    | 'nl'
    | 'no'
    | 'pl'
    | 'pt'
    | 'pt-br'
    | 'sv'
    | 'sl'
    | 'tr';
  language?:
    | 'ar'
    | 'ca'
    | 'da'
    | 'de'
    | 'en'
    | 'es'
    | 'eu'
    | 'fa'
    | 'fr'
    | 'hr'
    | 'he'
    | 'it'
    | 'ja'
    | 'ka'
    | 'kr'
    | 'nb'
    | 'nl'
    | 'nn'
    | 'pl'
    | 'pt_BR'
    | 'ru'
    | 'sl'
    | 'sv'
    | 'tr'
    | 'ukr'
    | 'zh_CN'
    | 'zh_TW';
  location?: string;
  mac_prefix?: string;
  max_workers?: number;
  migration?: string;
  migration_unsecure?: boolean | 0 | 1;
  'next-id'?: string;
  notify?: string;
  'registered-tags'?: string;
  replication?: string;
  'tag-style'?: string;
  u2f?: string;
  'user-tag-access'?: string;
  webauthn?: string;
} & Record<string, unknown>;

/** PUT /cluster/options — form/query parameters (path segments omitted). */
export type ClusterOptionsPutParams = {
  bwlimit?: string;
  'consent-text'?: string;
  console?: 'applet' | 'vv' | 'html5' | 'xtermjs';
  crs?: string;
  delete?: string;
  description?: string;
  email_from?: string;
  fencing?: 'watchdog' | 'hardware' | 'both';
  ha?: string;
  http_proxy?: string;
  keyboard?:
    | 'de'
    | 'de-ch'
    | 'da'
    | 'en-gb'
    | 'en-us'
    | 'es'
    | 'fi'
    | 'fr'
    | 'fr-be'
    | 'fr-ca'
    | 'fr-ch'
    | 'hu'
    | 'is'
    | 'it'
    | 'ja'
    | 'lt'
    | 'mk'
    | 'nl'
    | 'no'
    | 'pl'
    | 'pt'
    | 'pt-br'
    | 'sv'
    | 'sl'
    | 'tr';
  language?:
    | 'ar'
    | 'ca'
    | 'da'
    | 'de'
    | 'en'
    | 'es'
    | 'eu'
    | 'fa'
    | 'fr'
    | 'hr'
    | 'he'
    | 'it'
    | 'ja'
    | 'ka'
    | 'kr'
    | 'nb'
    | 'nl'
    | 'nn'
    | 'pl'
    | 'pt_BR'
    | 'ru'
    | 'sl'
    | 'sv'
    | 'tr'
    | 'ukr'
    | 'zh_CN'
    | 'zh_TW';
  location?: string;
  mac_prefix?: string;
  max_workers?: `${number}`;
  migration?: string;
  migration_unsecure?: '0' | '1';
  'next-id'?: string;
  notify?: string;
  'registered-tags'?: string;
  replication?: string;
  'tag-style'?: string;
  u2f?: string;
  'user-tag-access'?: string;
  webauthn?: string;
};
/** PUT /cluster/options — `data` payload after client unwrap. */
export type ClusterOptionsPutReturn = null;

/** GET /cluster/qemu — `data` payload after client unwrap. */
export type ClusterQemuGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/qemu/cpu-flags — form/query parameters (path segments omitted). */
export type ClusterQemuCpuFlagsGetParams = { accel?: 'kvm' | 'tcg'; arch?: 'x86_64' | 'aarch64' };
/** GET /cluster/qemu/cpu-flags — `data` payload after client unwrap. */
export type ClusterQemuCpuFlagsGetReturn = readonly ({
  description?: string;
  name: string;
  'supported-on'?: readonly string[];
} & Record<string, unknown>)[];
