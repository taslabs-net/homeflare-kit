/** Test-only PBS 4.2.6-1 wire fixture. Every HTTP request is intercepted; no live credentials. */
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type { PbsTarget } from './credentials.ts';

export const PBS_JOBS_TARGET: PbsTarget = {
  api: 'https://pbs.test:8007/api2/json',
  mount: 'pbs-test',
  scheme: 'pbs',
};

const sections: Record<string, string> = {
  datastore: 'datastore',
  prune: 'prune',
  sync: 'sync',
  verify: 'verification',
};
const numbers =
  /^(keep-(daily|hourly|last|monthly|weekly|yearly)|max-depth|outdated-after|transfer-last)$/;
const booleans = /^(disable|ignore-verified|remove-vanished|verified-only|verify-new)$/;

type Write = { method: string; path: string; form: Record<string, string> };

export const fakePbsJobs = () => {
  const rows = new Map<string, Record<string, unknown>>();
  const writes: Write[] = [];
  const calls: { method: string; path: string }[] = [];
  let failure: { status: number; body: unknown } | undefined;
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      return Response.json({
        data: { secret: 'fake-secret-not-real', token_id: 'test@pbs!fake' },
        lease_duration: 0,
      });
    }
    const path = decodeURIComponent(url.pathname.replace('/api2/json/', ''));
    calls.push({ method: request.method, path });
    if (request.method === 'GET' && failure !== undefined) {
      return Response.json(failure.body, { status: failure.status });
    }
    const parts = path.split('/');
    const family = parts[1] ?? '';
    const id = parts[2] ?? '';
    const row = rows.get(path);
    if (request.method === 'GET') {
      // ★ Measured live 2026-09-24: these four missing sections are plain-text HTTP400.
      return row === undefined
        ? new Response(`no such ${sections[family]} '${id}'`, { status: 400 })
        : Response.json({ data: row });
    }
    const form = Object.fromEntries(new URLSearchParams(await request.text()));
    writes.push({ method: request.method, path, form });
    if (request.method === 'DELETE') {
      rows.delete(path);
      return Response.json({ data: family === 'datastore' ? 'UPID:fake:delete' : null });
    }
    const key = request.method === 'POST' ? `${path}/${form['id'] ?? form['name']}` : path;
    const after = { ...rows.get(key) };
    for (const [name, value] of Object.entries(form)) {
      after[name] = numbers.test(name)
        ? Number(value)
        : booleans.test(name)
          ? value === '1'
          : value;
    }
    rows.set(key, after);
    // ★ Pinned schema: create datastore is Unit/null; DELETE alone yields a UPID.
    return Response.json({ data: null });
  };
  const fetchStub = Object.assign(stub, { preconnect: globalThis.fetch.preconnect });
  return {
    rows,
    writes,
    calls,
    failRead: (status: number, body: unknown) => {
      failure = { status, body };
    },
    reset: () => {
      rows.clear();
      calls.length = 0;
      writes.length = 0;
      failure = undefined;
    },
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetchStub as typeof fetch)),
    ),
  };
};
