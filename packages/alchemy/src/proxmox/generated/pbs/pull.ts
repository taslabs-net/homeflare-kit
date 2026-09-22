/**
 * Generated proxmox-backup-server API types for `/pull` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/types.ts    (`--check` compares without writing)
 * Manifest entry: `pbs-apidoc` — proxmox-backup-server 4.2.6-1 (running 4.2.3)
 *   sha256 274ab9f6fc075aea, read on a PBS host from
 *   /usr/share/doc/proxmox-backup/html/api-viewer/apidoc.js
 *
 * ⚠️ A REQUEST PARAMETER IS TEXT ON THE WIRE. `client.ts` sends form encoding, so an integer is
 *   `\`${number}\`` and a boolean is `'0' | '1'` — the spellings that reach the server. The
 *   vendor's BOUNDS on those values are enforced separately, at plan time, from
 *   pbs/../constraints (codegen/README.md). A response is JSON and is not spelled that way.
 */

/** POST /pull — form/query parameters (path segments omitted). */
export type PullPostParams = {
  'burst-in'?: string;
  'burst-out'?: string;
  'decryption-keys'?: readonly string[];
  'encrypted-only'?: '0' | '1';
  'group-filter'?: readonly string[];
  'max-depth'?: `${number}`;
  ns?: string;
  'rate-in'?: string;
  'rate-out'?: string;
  remote?: string;
  'remote-ns'?: string;
  'remote-store': string;
  'remove-vanished'?: '0' | '1';
  'resync-corrupt'?: '0' | '1';
  store: string;
  'transfer-last'?: `${number}`;
  'verified-only'?: '0' | '1';
  'worker-threads'?: `${number}`;
};
/** POST /pull — `data` payload after client unwrap. */
export type PullPostReturn = null;
