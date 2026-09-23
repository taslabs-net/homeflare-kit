/**
 * A fake PVE cluster for `Proxmox.Lxc`: containers in memory, tasks that finish at once, and the
 * OpenBao creds endpoint the mint reads — one Bun server, reached through `FetchHttpClient.Fetch`.
 *
 * ⛔ TEST-ONLY, AND NEVER A REAL HOST. No provider imports this file and it is not on the barrel.
 *   Hostnames are `.test` (RFC 2606) and are remapped to the loopback server; any other host is
 *   refused with ENOTFOUND rather than resolved (client.test.ts has the incident behind that).
 * ★ IT ANSWERS THE WAY PVE 9 DOES WHERE THE PROVIDER DEPENDS ON IT, and each shape is a measured
 *   one: a missing config is HTTP 500 with `message` in the JSON body (pve-http-server
 *   `Formatter/Standard.pm`); a PUT with a stale `digest` is refused; a create allocates
 *   `<storage>:subvol-<vmid>-disk-<n>,size=<n>G` and generates `hwaddr` and `type=veth`, as a live
 *   guest's own config shows; tags come back sorted and lower-cased (`get_unique_tags`).
 * ⚠️ EVERY MAC HERE IS FROM THE RFC 7042 DOCUMENTATION BLOCK (`00:00:5E:00:53:xx`), as every
 *   address is TEST-NET: PVE's own prefix is `BC:24:11`, but no value in this package may be one a
 *   real NIC could carry.
 */
import { pairs } from './lxc-wire.ts';

export type Seen = {
  readonly method: string;
  readonly path: string;
  readonly form: URLSearchParams;
};

export type FakePve = {
  /** Live configs, keyed `node/vmid`. Mutate freely between deploys to simulate hand edits. */
  readonly guests: Map<string, Record<string, unknown>>;
  /** Extra `GET /cluster/resources` rows — a QEMU VM, or a guest on another node. */
  readonly others: { vmid: number | string; node: string; type: string }[];
  /** Forced answers for `GET …/config`, keyed `node/vmid`: an HTTP status and a JSON body. */
  readonly configErrors: Map<string, { status: number; body: unknown }>;
  /**
   * Guests that read as ABSENT for the next N cluster listings (their config GET 500s meanwhile),
   * keyed `node/vmid` — a guest that appears between a plan and its deploy.
   */
  readonly vanish: Map<string, number>;
  /**
   * Hand edits that land mid-deploy, keyed `node/vmid`: once that guest's config has been read
   * `after` more times, `set` is merged into it — a change made between a plan and its apply.
   */
  readonly edits: Map<string, { after: number; readonly set: Record<string, unknown> }>;
  /** Config keys a `PUT …/config` accepts with 200 and then does not store. */
  readonly ignore: Set<string>;
  /** How every task ends, and whether a task-starting call answers with no UPID at all. */
  readonly task: { exit: string; noUpid: boolean };
  readonly seen: Seen[];
  readonly fetch: typeof fetch;
  readonly stop: () => void;
};

/** The member hostname a test target names, and the OpenBao address the mint is pointed at. */
export const FAKE_MEMBER = 'pve-a.test';
export const FAKE_BAO = 'http://bao.test:8200';

const json = (body: unknown, status = 200) => Response.json(body, { status });

let digestCounter = 0;
const nextDigest = () => {
  digestCounter += 1;
  return `digest-${String(digestCounter)}`;
};

/** What PVE's create does to the declared form: allocate volumes, fill NIC defaults, sort tags. */
const created = (vmid: string, form: URLSearchParams): Record<string, unknown> => {
  const config: Record<string, unknown> = { arch: 'amd64', ostype: 'debian', unprivileged: 1 };
  let disk = 0;
  for (const [key, value] of form) {
    if (['ostemplate', 'start', 'vmid'].includes(key)) continue;
    if (key === 'rootfs' || /^mp\d+$/.test(key)) {
      const [first, ...rest] = value.split(',');
      const fresh = /^([^:]+):(\d+)$/.exec(first ?? '');
      config[key] =
        fresh === null
          ? value
          : [
              `${fresh[1] ?? ''}:subvol-${vmid}-disk-${String(disk++)}`,
              ...rest,
              `size=${fresh[2] ?? '0'}G`,
            ].join(',');
    } else if (/^net\d+$/.test(key)) {
      const map = new Map(pairs(value));
      if (!map.has('hwaddr'))
        map.set('hwaddr', `00:00:5E:00:53:${vmid.slice(-2).padStart(2, '0')}`);
      if (!map.has('type')) map.set('type', 'veth');
      config[key] = [...map].map(([k, v]) => `${k}=${v}`).join(',');
    } else if (key === 'tags') {
      config[key] = [...new Set(value.toLowerCase().split(/[;,\s]+/))].sort().join(';');
    } else config[key] = /^\d+$/.test(value) ? Number(value) : value;
  }
  return config;
};

export const fakePve = (): FakePve => {
  const guests = new Map<string, Record<string, unknown>>();
  const others: { vmid: number | string; node: string; type: string }[] = [];
  const configErrors = new Map<string, { status: number; body: unknown }>();
  const vanish = new Map<string, number>();
  const edits: FakePve['edits'] = new Map();
  const ignore = new Set<string>();
  const task = { exit: 'OK', noUpid: false };
  const seen: Seen[] = [];
  let upids = 0;
  const upid = (node: string, kind: string, vmid: string) => {
    upids += 1;
    if (task.noUpid) return null;
    return `UPID:${node}:${String(upids).padStart(8, '0')}:0:0:${kind}:${vmid}:hf-test@pve!fake:`;
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    // ⚠️ QUERY AND BODY BOTH: a DELETE carries its parameters in the query, and a `force=1` there
    //   must be visible to the test that says there is none.
    const form = new URLSearchParams(url.search);
    if (request.method !== 'GET')
      for (const pair of new URLSearchParams(await request.text())) form.append(...pair);
    seen.push({ form, method: request.method, path: url.pathname });
    if (url.pathname.startsWith('/v1/') && url.pathname.includes('/creds/')) {
      return json({
        data: { secret: 'not-a-secret', token_id: 'hf-test@pve!fake' },
        lease_duration: 300,
      });
    }
    const path = url.pathname.replace(/^\/api2\/json\//, '');
    if (path === 'cluster/resources') {
      const rows = [...guests.keys()]
        .filter((key) => (vanish.get(key) ?? 0) <= 0)
        .map((key) => {
          const [node, vmid] = key.split('/');
          return { node, type: 'lxc', vmid: Number(vmid) };
        });
      for (const [key, left] of vanish) vanish.set(key, left - 1);
      return json({ data: [...rows, ...others] });
    }
    if (/^nodes\/[^/]+\/tasks\/.+\/status$/.test(path)) {
      return json({ data: { exitstatus: task.exit, status: 'stopped' } });
    }
    const create = /^nodes\/([^/]+)\/lxc$/.exec(path);
    if (create !== null && request.method === 'POST') {
      const node = create[1] ?? '';
      const vmid = form.get('vmid') ?? '';
      guests.set(`${node}/${vmid}`, { ...created(vmid, form), digest: nextDigest() });
      return json({ data: upid(node, 'vzcreate', vmid) });
    }
    const guest = /^nodes\/([^/]+)\/lxc\/(\d+)(\/config|\/resize)?$/.exec(path);
    if (guest === null) return json({ data: null, message: `no such path ${path}\n` }, 501);
    const [, node = '', vmid = '', tail] = guest;
    const forced = configErrors.get(`${node}/${vmid}`);
    if (forced !== undefined && tail === '/config' && request.method === 'GET') {
      return json(forced.body, forced.status);
    }
    const config =
      (vanish.get(`${node}/${vmid}`) ?? 0) > 0 ? undefined : guests.get(`${node}/${vmid}`);
    if (config === undefined) {
      const message = `Configuration file 'nodes/${node}/lxc/${vmid}.conf' does not exist\n`;
      return json({ data: null, message }, 500);
    }
    if (tail === '/config' && request.method === 'GET') {
      const answer = json({ data: config });
      const edit = edits.get(`${node}/${vmid}`);
      if (edit !== undefined && --edit.after === 0) Object.assign(config, edit.set);
      return answer;
    }
    if (tail === '/config' && request.method === 'PUT') {
      const digest = form.get('digest');
      if (digest !== null && digest !== config['digest']) {
        return json({ data: null, message: 'detected modified configuration\n' }, 500);
      }
      for (const [key, value] of form)
        if (key !== 'digest' && key !== 'delete' && !ignore.has(key)) config[key] = value;
      for (const key of (form.get('delete') ?? '').split(',')) if (key !== '') delete config[key];
      config['digest'] = nextDigest();
      return json({ data: null });
    }
    if (tail === '/resize' && request.method === 'PUT') {
      const disk = form.get('disk') ?? '';
      const current = String(config[disk] ?? '');
      config[disk] = current.replace(/size=[^,]+/, `size=${form.get('size') ?? ''}`);
      config['digest'] = nextDigest();
      return json({ data: upid(node, 'resize', vmid) });
    }
    if (tail === undefined && request.method === 'DELETE') {
      guests.delete(`${node}/${vmid}`);
      return json({ data: upid(node, 'vzdestroy', vmid) });
    }
    return json({ data: null, message: 'unhandled\n' }, 501);
  };

  // 🔴 LOOPBACK, NOT THE DEFAULT WILDCARD — AND THAT WAS THE FLAKE. Measured 2026-09-23 on
  //   macOS: `Bun.serve({ port: 0 })` binds 0.0.0.0, and the kernel will hand a wildcard
  //   port-0 bind a port some OTHER socket already holds on 127.0.0.1 (16,373 binds in, it
  //   did). Loopback traffic then goes to the more specific listener, so this fake's own
  //   requests reached another process's server — another test suite's fake, when several
  //   agents run `bun test` at once — and a plan failed with "Transport error" on a GET to a
  //   server that was up. A 127.0.0.1 port-0 bind is never handed a port in use on
  //   127.0.0.1, and nothing more specific can shadow it. tests/loopback-servers.test.ts
  //   keeps every test server this way.
  const server = Bun.serve({ fetch: handle, hostname: '127.0.0.1', port: 0 });
  const port = String(server.port);
  const remapped = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== FAKE_MEMBER && url.hostname !== new URL(FAKE_BAO).hostname) {
      return Promise.reject(
        Object.assign(new Error(`getaddrinfo ENOTFOUND ${url.hostname}`), {
          code: 'ENOTFOUND',
        }),
      );
    }
    url.protocol = 'http:';
    url.hostname = '127.0.0.1';
    url.port = port;
    return globalThis.fetch(url, init);
  };
  return {
    configErrors,
    edits,
    fetch: Object.assign(remapped, { preconnect: globalThis.fetch.preconnect }),
    guests,
    ignore,
    others,
    seen,
    stop: () => server.stop(true),
    task,
    vanish,
  };
};

/** Every call that changed something, as `METHOD path`, in order — OpenBao mints excluded. */
export const writesOf = (fake: FakePve) =>
  fake.seen
    .filter((call) => call.method !== 'GET')
    .map((call) => `${call.method} ${call.path.replace(/^\/api2\/json\//, '')}`);
