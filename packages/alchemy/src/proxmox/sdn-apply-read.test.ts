/**
 * The fabric comparison, which is what decides whether `Proxmox.SdnApply` publishes.
 *
 * ⛔ IT IS TESTED HERE RATHER THAN AGAINST THE CLUSTER BECAUSE STAGING A REAL FABRIC CHANGE MEANS
 *   TOUCHING CEPH'S CLUSTER NETWORK. TB4's OSPF fabric pins 10.100.0.102/103/104 to en05 and en06,
 *   and those are the addresses `cluster_network` runs over. The staged-zone path IS proven end to
 *   end against the live cluster (plan noop -> stage a zone -> plan update -> remove -> plan noop);
 *   the fabric path is proven by construction, with the two ways it could lie pinned below.
 *
 * ★ THE TWO WAYS IT COULD LIE, AND BOTH ARE FALSE POSITIVES. `?pending=1` carries a `digest` and
 *   `?running=1` does not, and the node list comes back in a different order between the two reads
 *   — MEASURED. Either would make the comparison report a difference on a cluster where nothing has
 *   changed, which is a forever-`update` on a resource whose update reloads the network on three
 *   nodes at once. That is worse than the bug this file was written to fix.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PveError } from './client.ts';
import { UNDIFFABLE, canonical, fabricStaged, subsystemAbsent } from './sdn-apply-read.ts';

/** The shape `cluster/sdn/fabrics/all` actually returns, trimmed to what matters. */
const N2 = {
  fabric_id: 'tb4',
  interfaces: ['name=en05', 'name=en06'],
  ip: '10.100.0.102',
  node_id: 'n2',
};
const N3 = {
  fabric_id: 'tb4',
  interfaces: ['name=en05', 'name=en06'],
  ip: '10.100.0.103',
  node_id: 'n3',
};

const running = {
  fabrics: [{ area: '1', id: 'tb4', ip_prefix: '10.100.0.0/24', protocol: 'ospf' }],
  nodes: [N2, N3],
};

describe('fabric canonicalisation', () => {
  it('ignores the digest the pending view carries and the running view does not', () => {
    const pending = {
      fabrics: [
        {
          area: '1',
          digest: '7b94d363ff69',
          id: 'tb4',
          ip_prefix: '10.100.0.0/24',
          protocol: 'ospf',
        },
      ],
      nodes: running.nodes.map((n) => ({ ...n, digest: '7b94d363ff69' })),
    };
    assert.equal(canonical(pending), canonical(running));
  });

  it('ignores node order, which is not stable between the two reads', () => {
    const reordered = { ...running, nodes: [...running.nodes].reverse() };
    assert.equal(canonical(reordered), canonical(running));
  });

  it('ignores key order within a node', () => {
    const shuffled = {
      ...running,
      nodes: running.nodes.map((n) => ({
        node_id: n.node_id,
        ip: n.ip,
        interfaces: n.interfaces,
        fabric_id: n.fabric_id,
      })),
    };
    assert.equal(canonical(shuffled), canonical(running));
  });

  // ⛔ AND THE DIRECTION THAT MATTERS: a real change must NOT be canonicalised away.
  it('sees a changed node address', () => {
    const moved = {
      ...running,
      nodes: [{ ...N2, ip: '10.100.0.199' }, N3],
    };
    assert.notEqual(canonical(moved), canonical(running));
  });

  it('sees an added node — the shape of a fabric gaining a member', () => {
    const added = {
      ...running,
      nodes: [
        ...running.nodes,
        { fabric_id: 'tb4', interfaces: ['name=en05'], ip: '10.100.0.104', node_id: 'n4' },
      ],
    };
    assert.notEqual(canonical(added), canonical(running));
  });

  it('sees a changed interface list, which is what decides where the address lands', () => {
    const rewired = {
      ...running,
      nodes: [{ ...N2, interfaces: ['name=en05'] }, N3],
    };
    assert.notEqual(canonical(rewired), canonical(running));
  });
});

describe('the stated blind spot', () => {
  // ⚠️ ipams and dns answer HTTP 400 to ?pending=1 — there is no way to ask them what is staged.
  //    The list exists so the gap is NAMED rather than silently folded to zero, which is what the
  //    old `orElseSucceed(() => 0)` would have done if anyone had added them to the counted set.
  it('names the collections that cannot be diffed at all', () => {
    assert.deepEqual([...UNDIFFABLE], ['cluster/sdn/ipams', 'cluster/sdn/dns']);
  });
});

/**
 * ⛔ WHAT A FAILED READ IS ALLOWED TO MEAN. Every failure used to read as "nothing staged", so an
 *   expired read lease answered `noop` — and one failed fabric view, compared with a real one, read
 *   as a DIFFERENCE, which is `PUT /cluster/sdn` and a network reload carrying Ceph's cluster
 *   network on all three nodes. Found in review 2026-09-14. A failure other than 501 now fails the
 *   read outright; that path runs through `pve` and is proven by the live plan, not here.
 */
describe('what a failed read is allowed to mean', () => {
  it('reads only a 501 as an absent subsystem', () => {
    assert.equal(
      subsystemAbsent(new PveError(501, 'GET', 'cluster/sdn/zones?pending=1', '')),
      true,
    );
    for (const status of [0, 400, 401, 403, 500, 502, 596]) {
      const failure = new PveError(status, 'GET', 'cluster/sdn/zones?pending=1', '');
      assert.equal(subsystemAbsent(failure), false, `status ${String(status)}`);
    }
  });

  it('never reads something that is not a PVE answer as an absent subsystem', () => {
    assert.equal(subsystemAbsent(new Error('501')), false);
    assert.equal(subsystemAbsent({ status: 501 }), false);
  });

  it('counts an unchanged fabric as nothing staged and a moved node as staged', () => {
    const moved = { ...running, nodes: [{ ...N2, ip: '10.100.0.199' }, N3] };
    assert.equal(fabricStaged(canonical(running), canonical(running)), 0);
    assert.equal(fabricStaged(canonical(moved), canonical(running)), 1);
  });

  it('counts a fabric subsystem absent from both views as nothing staged', () => {
    assert.equal(fabricStaged(undefined, undefined), 0);
  });

  // ⛔ THE CEPH CASE: one view absent is refused, never counted as a difference.
  it('refuses one absent view rather than calling it a difference', () => {
    assert.equal(fabricStaged(undefined, canonical(running)), 'inconsistent');
    assert.equal(fabricStaged(canonical(running), undefined), 'inconsistent');
  });
});
