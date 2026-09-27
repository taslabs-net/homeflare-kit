/**
 * Precise container discovery, with cluster-wide vmid collision checks.
 * ⛔ A config path missing on one node does not mean its vmid is free: migration or a QEMU
 *   guest may hold it. Only the SDK's exact LxcConfigNotFound permits the second observation.
 *   Generic 500s, permission failures and malformed successes never authorize creation.
 * ★ SAME CREDENTIAL FOR BOTH READS. Installed pve-container6.1.13 Config.pm:31 checks
 *   VM.Audit on /vms/{vmid} before AbstractConfig.pm:58 raises the missing-config error.
 *   The pinned pve-manager9.2.11 Cluster.pm:588 filters rows by that SAME permission. Keeping
 *   the credential makes an absent row meaningful for this vmid without claiming the entire
 *   cluster list is unfiltered. A newly minted credential would not carry that evidence.
 */
import * as cluster from '@distilled.cloud/proxmox/cluster';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { runPveWith } from './distilled-pve.ts';
import { leased } from './lease-cache.ts';
import { LxcRefusedError, type LxcWhere } from './lxc-errors.ts';
import { text } from './values.ts';

export const readLive = (where: LxcWhere) =>
  Effect.gen(function* () {
    const credential = yield* leased(where.target, 'read');
    const answer = yield* runPveWith(
      where.target,
      credential,
      false,
      nodes.getNodeLxcConfig({ node: where.node, vmid: String(where.vmid) }),
    ).pipe(
      Effect.map((data) => ({ data, error: undefined })),
      Effect.catchTag('LxcConfigNotFound', (error) => Effect.succeed({ data: undefined, error })),
    );
    if (answer.error === undefined) {
      const live: unknown = answer.data;
      // ⛔ The vendor requires digest on a real config. Null/empty output is not absence.
      if (
        live === null ||
        typeof live !== 'object' ||
        Array.isArray(live) ||
        !('digest' in live) ||
        typeof live.digest !== 'string' ||
        live.digest === ''
      ) {
        return yield* Effect.fail(
          new LxcRefusedError(
            `CT ${String(where.vmid)}: config read did not return a valid digest-bearing config.`,
          ),
        );
      }
      return live as Record<string, unknown>;
    }
    const rows = yield* runPveWith(
      where.target,
      credential,
      false,
      cluster.listClusterResources({ type: 'vm' }),
    );
    // ⛔ Unknown row identities cannot establish that this cluster-wide vmid is free.
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          !Number.isSafeInteger(Number(row?.vmid)) ||
          Number(row?.vmid) <= 0 ||
          typeof row?.node !== 'string' ||
          row.node === '' ||
          !['lxc', 'qemu'].includes(row.type),
      )
    ) {
      return yield* Effect.fail(
        new LxcRefusedError('The cluster guest index did not identify its rows.'),
      );
    }
    // Number() preserves the vendor's numeric/string vmid spellings.
    const found = rows.find((row) => Number(row.vmid) === where.vmid);
    if (found !== undefined && found.node === where.node && found.type === 'lxc') {
      return yield* Effect.fail(answer.error);
    }
    if (found !== undefined) {
      return yield* Effect.fail(
        new LxcRefusedError(
          `vmid ${String(where.vmid)} is a ${text(found.type, 'guest')} on ` +
            `${text(found.node, '?')}, not a container on ${where.node}. A migration is not an ` +
            'update and vmids are cluster-wide: declare the node it is on, or pick a free vmid.',
        ),
      );
    }
    return undefined;
  });
