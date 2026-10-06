/**
 * Fake apiserver for the `talos-openbao` tests: a `node:https` request spy (no socket, no DNS).
 *
 * ★ mock.module, not spyOn: alchemy imports `* as https`, a namespace a spy on the default export
 *   never reaches (measured 2026-10-06: the spy was bypassed and the test hit real DNS).
 * Every request is recorded as `METHOD host path`. A GET of kube-system answers the uid the test
 * assigned to that host (`uids`), so identity is exercised through the real adapter path; any
 * other request answers 200 with an empty object. `restore()` puts the real module back.
 */
import { EventEmitter } from 'node:events';
import * as httpsNamespace from 'node:https';
import { mock } from 'bun:test';

const realHttps = { ...httpsNamespace };

type FakeRequest = EventEmitter & { write: () => void; end: () => void };
type FakeResponse = EventEmitter & { statusCode?: number };

/**
 * `uids` maps an apiserver hostname to the kube-system uid it reports; `hang` lists hostnames that
 * accept the request and never answer.
 */
export const fakeApiServer = (
  uids: Readonly<Record<string, string>>,
  hang: readonly string[] = [],
) => {
  const seen: string[] = [];
  const fake = ((
    options: { hostname: string; method: string; path: string },
    callback: (response: FakeResponse) => void,
  ) => {
    const path = options.path.split('?')[0] ?? '';
    seen.push(`${options.method} ${options.hostname}${path}`);
    const request = new EventEmitter() as FakeRequest;
    request.write = () => undefined;
    request.end = () => {
      if (hang.includes(options.hostname)) return;
      const response = new EventEmitter() as FakeResponse;
      response.statusCode = 200;
      callback(response);
      const isIdentity = options.method === 'GET' && path === '/api/v1/namespaces/kube-system';
      const uid = isIdentity ? uids[options.hostname] : 'u1';
      const metadata = uid === undefined ? {} : { uid };
      response.emit('data', Buffer.from(JSON.stringify({ metadata })));
      response.emit('end');
    };
    return request;
  }) as never;
  mock.module('node:https', () => ({
    ...realHttps,
    default: { ...realHttps, request: fake },
    request: fake,
  }));
  return { restore: () => mock.module('node:https', () => realHttps), seen };
};
