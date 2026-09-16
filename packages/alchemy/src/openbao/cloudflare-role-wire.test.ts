/**
 * Bao.CloudflareRole's calls against a fake that behaves like the Cloudflare engine where it matters:
 * a write parses the duration text into seconds and re-marshals `policies` (path_roles.go:117-146,
 * :199-210), a role never written is a 404, and a delete answers 204 whether or not it existed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaoError } from './bao-status.ts';
import { atEveryScope, resolvePolicies } from './cloudflare-policy.ts';
import { type BaoCloudflareRoleProps, differences, writeBody } from './cloudflare-role-form.ts';
import {
  deleteCloudflareRole,
  readCloudflareRole,
  writeCloudflareRole,
} from './cloudflare-role-wire.ts';
import { type Reply, type Seen, run, runFailure, withFake } from './fake-bao.ts';
import { parseDuration } from './mount-form.ts';

const PROPS: BaoCloudflareRoleProps = {
  description: 'Read DNS records on one zone. (zone: example.com)',
  maxTtl: '1h',
  mount: 'cloudflare-acme-dns',
  name: 'example-com-dns-read',
  policies: [
    {
      effect: 'allow',
      groupOrder: 'declared',
      groups: ['DNS Read'],
      resource: 'com.cloudflare.api.account.zone.z1',
    },
  ],
  ttl: '5m',
};

const PATH = '/v1/cloudflare-acme-dns/roles/example-com-dns-read';

/** The engine's role store, reduced to what these calls can observe. */
const roleStore = () => {
  const roles = new Map<string, Record<string, unknown>>();
  return (seen: Seen): Reply => {
    if (seen.method === 'PUT') {
      const body = JSON.parse(seen.body) as Record<string, string>;
      roles.set(seen.path, {
        description: body['description'],
        max_ttl: parseDuration(body['max_ttl'] ?? ''),
        name: seen.path.split('/').at(-1),
        // ★ Re-marshalled, as json.Marshal of the stored structs would be.
        policies: JSON.stringify(JSON.parse(body['policies'] ?? 'null')),
        ttl: parseDuration(body['ttl'] ?? ''),
      });
      return { status: 204 };
    }
    if (seen.method === 'DELETE') {
      roles.delete(seen.path);
      return { status: 204 };
    }
    const role = roles.get(seen.path);
    return role === undefined
      ? { json: { errors: [] }, status: 404 }
      : { json: { data: role }, status: 200 };
  };
};

describe('Cloudflare role wire', () => {
  it('reads a role that was never written as absent', async () => {
    await withFake(roleStore(), async (bao) => {
      const env = { BAO_ADDR: bao.address };
      assert.equal(await run(env, readCloudflareRole(PROPS.mount, PROPS.name)), undefined);
      assert.deepEqual([bao.seen[0]?.method, bao.seen[0]?.path], ['GET', PATH]);
    });
  });

  it('writes the four fields and reads them back with no difference', async () => {
    await withFake(roleStore(), async (bao) => {
      const env = { BAO_ADDR: bao.address };
      const { policies } = resolvePolicies(
        PROPS.policies,
        atEveryScope(new Map([['DNS Read', 'id-read']])),
      );
      await run(env, writeCloudflareRole(PROPS.mount, PROPS.name, writeBody(PROPS, policies)));
      const put = bao.seen[0];
      assert.deepEqual([put?.method, put?.path], ['PUT', PATH]);
      assert.equal(put?.headers.get('content-type'), 'application/json');
      assert.deepEqual(JSON.parse(put?.body ?? ''), {
        description: PROPS.description,
        max_ttl: '1h',
        policies:
          '[{"effect":"allow","resources":{"com.cloudflare.api.account.zone.z1":"*"},' +
          '"permission_groups":[{"id":"id-read"}]}]',
        ttl: '5m',
      });
      const live = await run(env, readCloudflareRole(PROPS.mount, PROPS.name));
      assert.ok(live);
      assert.deepEqual([live.ttl, live.maxTtl], [300, 3600]);
      assert.deepEqual(differences(PROPS, policies, live), []);
    });
  });

  it('fails a refused read (403) instead of calling the role absent', async () => {
    await withFake(
      () => ({ json: { errors: ['permission denied'] }, status: 403 }),
      async (bao) => {
        const error = await runFailure({ BAO_ADDR: bao.address }, readCloudflareRole('m', 'r'));
        assert.ok(error instanceof BaoError);
        assert.equal(error.status, 403);
      },
    );
  });

  it('fails a write to a mount that is not there (404), carrying OpenBao errors', async () => {
    const errors = ['no handler for route "cloudflare-nope/roles/r". route entry not found.'];
    await withFake(
      () => ({ json: { errors }, status: 404 }),
      async (bao) => {
        const write = writeCloudflareRole('cloudflare-nope', 'r', { ttl: '5m' });
        const error = await runFailure({ BAO_ADDR: bao.address }, write);
        assert.ok(error instanceof BaoError);
        assert.deepEqual(error.errors, errors);
      },
    );
  });

  it('deletes idempotently: a role already gone is success', async () => {
    await withFake(
      () => ({ json: { errors: [] }, status: 404 }),
      async (bao) => {
        await run({ BAO_ADDR: bao.address }, deleteCloudflareRole(PROPS.mount, PROPS.name));
        assert.deepEqual([bao.seen[0]?.method, bao.seen[0]?.path], ['DELETE', PATH]);
      },
    );
  });
});
