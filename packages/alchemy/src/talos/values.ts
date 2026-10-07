/**
 * Coercions and digests for Talos resources — every function here exists because a trap does.
 *
 * ⚠️ NOTHING IN THIS FILE TOUCHES A LIVE CLUSTER OR OpenBao. Digests are computed from KV content
 *   or talosctl output already fetched by the caller, and kubeconfig YAML already on disk at
 *   reconcile time; tests use fixtures only.
 */
import { createHash } from 'node:crypto';
import { parseYaml } from './yaml-parse.ts';

/** Trim trailing whitespace only — leading space in YAML is meaningful. */
export const canonicalText = (text: string) => text.trimEnd();

/** SHA-256 hex digest of canonical text. Safe to persist — it is not reversible to the input. */
export const sha256 = (text: string) =>
  createHash('sha256').update(canonicalText(text)).digest('hex');

/** Digest of a machine config's canonical text. ⛔ Never persist the text itself. */
export const configDigest = (text: string) => sha256(text);

/**
 * Extract the raw config text under `spec` from `talosctl get machineconfig -o yaml`'s wrapper.
 *
 * ⛔ THE WHOLE WRAPPER CAN NEVER MATCH THE PINNED DIGEST, AND HASHING IT WAS THE SHIPPED BUG.
 *   REASONED from talosctl source (`cmd/talosctl/.../output/yaml.go:63`,
 *   `resources/config/machine_config.go:40-50`): the resource envelope nests a `node:` line and
 *   resource metadata (version, timestamps) around the config, which is itself a raw YAML STRING
 *   under `spec`. Metadata changes on every observation, so `configDigest(wrapper)` never equals
 *   `configDigest(seededConfigText)` even when nothing changed — every reconcile would die, every
 *   diff would plan `update`, verify would never go quiet (all three MEASURED against the shipped
 *   code's shape, docs/plans/2026-09-26-talos-stack-first-boot.md).
 * ⚠️ Returns `undefined` for any shape without a string `spec`, so a caller cannot mistake
 *   "unparsable wrapper" for "empty config" — those must fail differently (the caller's job).
 * ⛔ MORE THAN ONE DOCUMENT IS REFUSED, NEVER `doc[0]` (fix-first #2, PR 307 red team). An unfiltered
 *   `get machineconfig` lists BOTH the `persistent` and `v1alpha1` resources, sorted by id
 *   (REASONED, cosi-project/runtime `inmem/collection.go:122-124`), so a bare `doc[0]` is always
 *   `persistent` — never the config this package applies. The caller (machine-config-read.ts) now
 *   always requests the single named resource (`get machineconfig v1alpha1`); a second document
 *   showing up here means that request shape changed without this guard changing with it, and
 *   silently picking one would repeat the exact shipped bug.
 */
export const extractMachineConfigSpec = (wrapperYaml: string): string | undefined => {
  let doc = parseYaml(wrapperYaml);
  if (Array.isArray(doc)) {
    if (doc.length !== 1) return undefined;
    doc = doc[0];
  }
  if (doc === null || typeof doc !== 'object') return undefined;
  const spec = (doc as { spec?: unknown }).spec;
  return typeof spec === 'string' ? spec : undefined;
};

type KubeconfigDoc = {
  clusters?: {
    cluster?: { server?: string; 'certificate-authority-data'?: string };
    name?: string;
  }[];
  contexts?: { context?: { cluster?: string; user?: string }; name?: string }[];
  users?: {
    name?: string;
    user?: { 'client-certificate-data'?: string; 'client-key-data'?: string };
  }[];
  'current-context'?: string;
};

/**
 * Public metadata extracted from a kubeconfig file on disk.
 *
 * ⛔ RETURNS FINGERPRINTS ONLY. The admin kubeconfig contains a client certificate; Alchemy state
 *   may hold the API server URL and CA/client cert digests, never the PEM bytes.
 */
export const kubeconfigMetadata = (
  yamlText: string,
  contextName: string,
): { endpoint: string; caFingerprint: string; clientFingerprint: string } | undefined => {
  const parsed = parseYaml(yamlText);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const doc = parsed as KubeconfigDoc;

  const ctx = doc.contexts?.find((row) => row.name === contextName)?.context;
  const clusterName = ctx?.cluster;
  const userName = ctx?.user;
  if (clusterName === undefined || userName === undefined) return undefined;

  const cluster = doc.clusters?.find((row) => row.name === clusterName)?.cluster;
  const user = doc.users?.find((row) => row.name === userName)?.user;
  const endpoint = cluster?.server;
  const ca = cluster?.['certificate-authority-data'];
  const cert = user?.['client-certificate-data'] ?? user?.['client-key-data'];
  if (endpoint === undefined || ca === undefined || cert === undefined) return undefined;

  return {
    caFingerprint: sha256(ca),
    clientFingerprint: sha256(cert),
    endpoint,
  };
};
