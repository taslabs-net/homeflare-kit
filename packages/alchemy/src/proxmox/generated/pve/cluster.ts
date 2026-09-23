/**
 * Generated pve-manager API types for `/cluster` — DO NOT EDIT BY HAND.
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

/** GET /cluster — `data` payload after client unwrap. */
export type ClusterGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/acme — `data` payload after client unwrap. */
export type ClusterAcmeGetReturn = readonly Record<string, unknown>[];

/** GET /cluster/acme/account — `data` payload after client unwrap. */
export type ClusterAcmeAccountGetReturn = readonly Record<string, unknown>[];

/** POST /cluster/acme/account — form/query parameters (path segments omitted). */
export type ClusterAcmeAccountPostParams = {
  contact: string;
  directory?: string;
  'eab-hmac-key'?: string;
  'eab-kid'?: string;
  name?: string;
  tos_url?: string;
};
/** POST /cluster/acme/account — `data` payload after client unwrap. */
export type ClusterAcmeAccountPostReturn = string;

/** GET /cluster/acme/account/{name} — `data` payload after client unwrap. */
export type ClusterAcmeAccountNameGetReturn = {
  account?: unknown;
  directory?: string;
  location?: string;
  tos?: string;
};

/** PUT /cluster/acme/account/{name} — form/query parameters (path segments omitted). */
export type ClusterAcmeAccountNamePutParams = { contact?: string };
/** PUT /cluster/acme/account/{name} — `data` payload after client unwrap. */
export type ClusterAcmeAccountNamePutReturn = string;

/** DELETE /cluster/acme/account/{name} — `data` payload after client unwrap. */
export type ClusterAcmeAccountNameDeleteReturn = string;

/** GET /cluster/acme/challenge-schema — `data` payload after client unwrap. */
export type ClusterAcmeChallengeSchemaGetReturn = readonly {
  id: string;
  name: string;
  schema: unknown;
  type: string;
}[];

/** GET /cluster/acme/directories — `data` payload after client unwrap. */
export type ClusterAcmeDirectoriesGetReturn = readonly { name: string; url: string }[];

/** GET /cluster/acme/meta — form/query parameters (path segments omitted). */
export type ClusterAcmeMetaGetParams = { directory?: string };
/** GET /cluster/acme/meta — `data` payload after client unwrap. */
export type ClusterAcmeMetaGetReturn = {
  caaIdentities?: readonly string[];
  externalAccountRequired?: boolean | 0 | 1;
  termsOfService?: string;
  website?: string;
} & Record<string, unknown>;
