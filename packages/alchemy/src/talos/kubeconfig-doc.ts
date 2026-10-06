/**
 * In-memory kubeconfig parse for `talos-openbao` connect.
 *
 * ⛔ THE RESULT HOLDS PEM. Callers may put it on a `ClusterTransport` for one request.
 *   They must not persist it, log it, or copy it onto a `Connection`. Alchemy stores
 *   connection attributes in plaintext (`credentials.ts`'s own header).
 * ★ YAML IS `yaml-parse.ts` (runtime-neutral: Bun.YAML does not exist under Node, where the
 *   published dist runs). Nothing here touches a filesystem or OpenBao — the caller has already
 *   read the bytes.
 *
 * Walked against alchemy 2.0.0-beta.79 `Kubernetes/internal/client.ts`: `certificateAuthorityData`
 * stays base64 (the client decodes it) and `clientCert` is PEM. The document shape is the one
 * `values.ts` parses from the Talos v1.13 kubeconfig reference. Not measured on a live cluster.
 */
import type { ClusterTransport } from 'alchemy/Kubernetes/ClusterAdapter';
import { parseYaml } from './yaml-parse.ts';

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
};

export type KubeconfigMaterial = Pick<
  ClusterTransport,
  'certificateAuthorityData' | 'clientCert' | 'endpoint'
>;

/** Base64 kubeconfig field → PEM, or `undefined` when it is not a PEM payload. */
const pem = (data: string | undefined): string | undefined => {
  if (data === undefined || data.trim() === '') return undefined;
  const decoded = Buffer.from(data, 'base64').toString('utf8');
  return decoded.includes('BEGIN ') ? decoded : undefined;
};

/**
 * Resolve `contextName` to endpoint, base64 CA, and PEM client cert/key.
 * `undefined` for any shape that is not that context's admin kubeconfig — the caller
 * fails closed without embedding the document in the error.
 */
export const kubeconfigTransport = (
  yamlText: string,
  contextName: string,
): KubeconfigMaterial | undefined => {
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
  const certificateAuthorityData = cluster?.['certificate-authority-data'];
  const certificate = pem(user?.['client-certificate-data']);
  const key = pem(user?.['client-key-data']);
  if (
    endpoint === undefined ||
    certificateAuthorityData === undefined ||
    pem(certificateAuthorityData) === undefined ||
    certificate === undefined ||
    key === undefined
  ) {
    return undefined;
  }
  return { certificateAuthorityData, clientCert: { certificate, key }, endpoint };
};
