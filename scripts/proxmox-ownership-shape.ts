/**
 * The shape of an ownership row, and the three claim patterns the ledger halves reuse.
 *
 * ⚠️ SEPARATE FROM `proxmox-ownership.ts` ON PURPOSE. That file imports both halves and the halves
 *   need these types, so putting them there is a cycle: Bun evaluates the half first and `P` is
 *   still in its temporal dead zone (`Cannot access 'P' before initialization`).
 *
 * ★ THIS FILE AND THE TWO LEDGER HALVES BESIDE IT ARE HAND-WRITTEN, AND THAT IS THE POINT. Every other artefact in
 *   the coverage pipeline is generated from the vendor schema; this one is the claim we make ABOUT
 *   our own code, and `tests/api-coverage.test.ts` checks every line of it against that schema. A
 *   claim that stops being true is a failing test, not a stale paragraph in a gap document.
 *
 * ⛔ READ-ONLY CALLS ARE NOT LISTED. `GET` never changes the cluster, so it is not what a coverage
 *   report is for. Only POST / PUT / DELETE appear, because those are the calls a vendor rule our
 *   generated types never carried can refuse at apply time.
 *
 * ⚠️ PATHS ARE SPELLED THE VENDOR'S WAY, e.g. `/nodes/{node}/lxc/{vmid}`, not the template literal
 *   in the provider. The test matches them against the schema EXACTLY, parameter names included,
 *   so a typo here fails rather than quietly matching nothing.
 */

/** A Proxmox product. The two schemas are separate documents from separate hosts. */
export type System = 'pve' | 'pbs';

export type Claim = {
  readonly method: 'POST' | 'PUT' | 'DELETE';
  /** The vendor path, with the vendor's own parameter names. */
  readonly path: string;
};

export type Note = Claim & { readonly why: string };

export type Ownership = {
  /** The Alchemy resource kind, exactly as `Resource<…>('…')` declares it. */
  readonly resource: string;
  readonly system: System;
  /** Repo-relative source file, so a reader can go straight to the calls. */
  readonly file: string;
  /** Endpoints this resource really sends. Each MUST exist in the schema. */
  readonly writes: readonly Claim[];
  /**
   * Endpoints the source documents as NOT implemented by the vendor, and therefore never sends.
   * Each MUST BE ABSENT from the schema — so if Proxmox ever adds one, the test says the comment
   * that calls it unreachable has gone stale.
   */
  readonly refuted?: readonly Note[];
  /**
   * A call the provider DOES send to an endpoint the vendor does not implement. A defect, recorded
   * rather than hidden: the test asserts the endpoint really is absent, so the row cannot outlive
   * the bug it describes.
   */
  readonly broken?: readonly Note[];
};

/** The repo-relative home of the Proxmox providers, so no entry repeats it. */
export const P = 'packages/alchemy/src/proxmox';

/**
 * The shape almost every family has: POST the collection, PUT and DELETE the object.
 * ⚠️ Not universal — Acl is PUT-only, CephOsd has no PUT, ApiToken POSTs the object itself.
 *   Those spell their claims out instead of calling this.
 */
export const crud = (collection: string, object: string): readonly Claim[] => [
  { method: 'POST', path: collection },
  { method: 'PUT', path: object },
  { method: 'DELETE', path: object },
];

/** POST the collection, DELETE the object, nothing editable in between. */
export const createDestroy = (collection: string, object: string): readonly Claim[] => [
  { method: 'POST', path: collection },
  { method: 'DELETE', path: object },
];

/** Both notification families: PVE and PBS register one path per endpoint type, not a `{type}`. */
export const NOTIFICATION_TYPES = ['gotify', 'sendmail', 'smtp', 'webhook'] as const;

export const notificationEndpoints = (base: string): readonly Claim[] =>
  NOTIFICATION_TYPES.flatMap((t) => crud(`${base}/${t}`, `${base}/${t}/{name}`));
