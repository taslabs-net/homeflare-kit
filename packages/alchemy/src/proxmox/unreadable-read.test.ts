/**
 * The cries-wolf fix (unreadable-read.ts), proved end to end for `Proxmox.Acl` — the reference
 * migrated family — through Alchemy's own Plan and Apply, over a fake cluster whose OpenBao mint
 * can be flipped to DENY the `provision` role mid-test, the way the agent lane's policy denies it
 * for real (measured 2026-09-24, decision doc's "cries wolf" entry: 14 ACLs read back as absent
 * and forced `update` with nothing compared).
 *
 * ★ ONE ENGINE, ONE TRANSPORT, A MUTABLE DENIAL FLAG — not two fakes — because the state row this
 *   test needs (`output !== undefined`, the exact case the bug forced `update` for) has to
 *   survive from the first deploy (mint allowed) into the second plan (mint denied);
 *   fake-engine.ts builds its in-memory state store fresh per `engineOver` call, so the same
 *   engine instance is reused for both, and only the fake OpenBao's answer to `/creds/provision`
 *   changes in between. `lease_duration: 0` on every fake mint (both branches) keeps
 *   lease-cache.ts cold, so the second phase genuinely re-mints and hits the denial.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { engineOver } from '../verify/fake-engine.ts';
import { ProxmoxAcl, ProxmoxAclProvider } from './acl.ts';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';

type Row = { path: string; type: string; ugid: string; roleid: string; propagate?: number };

/** One ACL row, plus an OpenBao mint the test can deny for `provision` mid-run. */
const clusterDenyingProvision = (rows: readonly Row[]) => {
  let denyProvision = false;
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      if (denyProvision && url.pathname.endsWith('/creds/provision')) {
        return Response.json({ errors: ['permission denied'] }, { status: 403 });
      }
      const data = { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' };
      return Response.json({ data, lease_duration: 0 });
    }
    const path = `${url.pathname.replace(/^\/api2\/json\//, '')}${url.search}`;
    if (request.method === 'GET' && path === 'access/acl') return Response.json({ data: rows });
    // ⛔ Any other write is a bug this test would otherwise hide: once denied, `reconcile` must
    //   never be reached (diff answers noop), so nothing should ever PUT here again.
    return Response.json({ data: null });
  };
  const fetchStub = Object.assign(stub, { preconnect: globalThis.fetch.preconnect });
  return {
    deny: () => {
      denyProvision = true;
    },
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetchStub as typeof fetch)),
    ),
  };
};

const grant = () =>
  ProxmoxAcl('auditor', {
    path: '/',
    roleid: 'PVEAuditor',
    target: FAKE_TARGET,
    type: 'user',
    ugid: 'u@pve',
  });

describe('the cries-wolf fix: a refused provision mint reports noop, never update', () => {
  test('an already-correct grant plans noop once the credential is denied, and nothing is written', async () => {
    const rows: Row[] = [
      { path: '/', propagate: 1, roleid: 'PVEAuditor', type: 'user', ugid: 'u@pve' },
    ];
    const fake = clusterDenyingProvision(rows);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxAclProvider().pipe(Layer.provideMerge(fake.layer)));
      // First deploy: mint allowed, adopts the matching grant and records a state row.
      expect(await engine.deploy(grant())).toEqual({ auditor: 'adopted' });
      // Now the credential's role is denied -- exactly the measured agent-lane scenario.
      fake.deny();
      const report = await engine.verify(grant(), { all: true });
      // ⛔ THE BUG THIS PROVES FIXED: before the fix this row read 'update' with nothing compared.
      expect(report.rows[0]).toMatchObject({ diff: 'noop' });
      expect(await engine.deploy(grant())).toEqual({ auditor: 'noop' });
    });
  });
});
