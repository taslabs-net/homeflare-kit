/**
 * Generated proxmox-backup-server API types for `/nodes` — DO NOT EDIT BY HAND.
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

/** GET /nodes — `data` payload after client unwrap. */
export type NodesGetReturn = null;

/** GET /nodes/{node} — `data` payload after client unwrap. */
export type NodesNodeGetReturn = null;

/** GET /nodes/{node}/apt — `data` payload after client unwrap. */
export type NodesNodeAptGetReturn = null;

/** GET /nodes/{node}/apt/changelog — form/query parameters (path segments omitted). */
export type NodesNodeAptChangelogGetParams = { name: string; version?: string };
/** GET /nodes/{node}/apt/changelog — `data` payload after client unwrap. */
export type NodesNodeAptChangelogGetReturn = string;

/** GET /nodes/{node}/apt/repositories — `data` payload after client unwrap. */
export type NodesNodeAptRepositoriesGetReturn = {
  digest: string;
  errors: readonly { error: string; path: string }[];
  files: readonly {
    content?: string;
    digest?: string;
    'file-type': 'list' | 'sources';
    path?: string;
    repositories: readonly {
      Comment?: string;
      Components: readonly string[];
      Enabled: boolean | 0 | 1;
      FileType: 'list' | 'sources';
      Options?: readonly { Key: string; Values: readonly string[] }[];
      Suites: readonly string[];
      Types: readonly ('deb' | 'deb-src')[];
      URIs: readonly string[];
    }[];
  }[];
  infos: readonly { index: number; kind: string; message: string; path: string; property?: string }[];
  'standard-repos': readonly {
    description: string;
    handle: string;
    name: string;
    status?: boolean | 0 | 1;
  }[];
};

/** POST /nodes/{node}/apt/repositories — form/query parameters (path segments omitted). */
export type NodesNodeAptRepositoriesPostParams = {
  digest?: string;
  enabled?: '0' | '1';
  index: `${number}`;
  path: string;
};
/** POST /nodes/{node}/apt/repositories — `data` payload after client unwrap. */
export type NodesNodeAptRepositoriesPostReturn = null;

/** PUT /nodes/{node}/apt/repositories — form/query parameters (path segments omitted). */
export type NodesNodeAptRepositoriesPutParams = { digest?: string; handle: string };
/** PUT /nodes/{node}/apt/repositories — `data` payload after client unwrap. */
export type NodesNodeAptRepositoriesPutReturn = null;

/** GET /nodes/{node}/apt/update — `data` payload after client unwrap. */
export type NodesNodeAptUpdateGetReturn = readonly {
  Arch: string;
  Description: string;
  ExtraInfo?: string;
  OldVersion?: string;
  Origin: string;
  Package: string;
  Priority: string;
  Section: string;
  Title: string;
  Version: string;
}[];

/** POST /nodes/{node}/apt/update — form/query parameters (path segments omitted). */
export type NodesNodeAptUpdatePostParams = { notify?: '0' | '1'; quiet?: '0' | '1' };
/** POST /nodes/{node}/apt/update — `data` payload after client unwrap. */
export type NodesNodeAptUpdatePostReturn = string;

/** GET /nodes/{node}/apt/versions — `data` payload after client unwrap. */
export type NodesNodeAptVersionsGetReturn = readonly {
  Arch: string;
  Description: string;
  ExtraInfo?: string;
  OldVersion?: string;
  Origin: string;
  Package: string;
  Priority: string;
  Section: string;
  Title: string;
  Version: string;
}[];

/** GET /nodes/{node}/certificates — `data` payload after client unwrap. */
export type NodesNodeCertificatesGetReturn = null;

/** GET /nodes/{node}/certificates/acme — `data` payload after client unwrap. */
export type NodesNodeCertificatesAcmeGetReturn = null;

/** POST /nodes/{node}/certificates/acme/certificate — form/query parameters (path segments omitted). */
export type NodesNodeCertificatesAcmeCertificatePostParams = { force?: '0' | '1' };
/** POST /nodes/{node}/certificates/acme/certificate — `data` payload after client unwrap. */
export type NodesNodeCertificatesAcmeCertificatePostReturn = null;

/** PUT /nodes/{node}/certificates/acme/certificate — form/query parameters (path segments omitted). */
export type NodesNodeCertificatesAcmeCertificatePutParams = { force?: '0' | '1' };
/** PUT /nodes/{node}/certificates/acme/certificate — `data` payload after client unwrap. */
export type NodesNodeCertificatesAcmeCertificatePutReturn = null;

/** POST /nodes/{node}/certificates/custom — form/query parameters (path segments omitted). */
export type NodesNodeCertificatesCustomPostParams = {
  certificates: string;
  force?: '0' | '1';
  key?: string;
  restart?: '0' | '1';
};
/** POST /nodes/{node}/certificates/custom — `data` payload after client unwrap. */
export type NodesNodeCertificatesCustomPostReturn = readonly {
  filename: string;
  fingerprint?: string;
  issuer: string;
  notafter?: number;
  notbefore?: number;
  pem?: string;
  'public-key-bits'?: number;
  'public-key-type': string;
  san: readonly string[];
  subject: string;
}[];

/** DELETE /nodes/{node}/certificates/custom — form/query parameters (path segments omitted). */
export type NodesNodeCertificatesCustomDeleteParams = { restart?: '0' | '1' };
/** DELETE /nodes/{node}/certificates/custom — `data` payload after client unwrap. */
export type NodesNodeCertificatesCustomDeleteReturn = null;

/** GET /nodes/{node}/certificates/info — `data` payload after client unwrap. */
export type NodesNodeCertificatesInfoGetReturn = readonly {
  filename: string;
  fingerprint?: string;
  issuer: string;
  notafter?: number;
  notbefore?: number;
  pem?: string;
  'public-key-bits'?: number;
  'public-key-type': string;
  san: readonly string[];
  subject: string;
}[];
