/**
 * Coercions and digests for Talos resources — every function here exists because a trap does.
 *
 * ⚠️ NOTHING IN THIS FILE TOUCHES A LIVE CLUSTER. Digests are computed from repo files or from
 *   kubeconfig YAML already on disk at reconcile time; tests use fixtures only.
 */
import { createHash } from 'node:crypto';

/** Trim trailing whitespace only — leading space in YAML is meaningful. */
export const canonicalText = (text: string) => text.trimEnd();

/** SHA-256 hex digest of canonical text. Safe to persist — it is not reversible to the input. */
export const sha256 = (text: string) =>
  createHash('sha256').update(canonicalText(text)).digest('hex');

/** Digest of a machine config file read from the repo. ⛔ Never persist the file body itself. */
export const configDigest = (text: string) => sha256(text);

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
  let doc: KubeconfigDoc;
  try {
    doc = Bun.YAML.parse(yamlText) as KubeconfigDoc;
  } catch {
    return undefined;
  }

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

/** Resolve a config file path relative to the declaring stack file. */
export const resolveConfigPath = (stackDir: string, configFile: string) =>
  configFile.startsWith('/') ? configFile : `${stackDir}/${configFile}`;
