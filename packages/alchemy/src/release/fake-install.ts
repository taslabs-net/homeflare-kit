/**
 * The install lifecycle's test bench: a fake host, a synthetic release served at the REAL URLs next
 * to an `-enterprise` decoy, and `refused()`, which asserts a refusal left the host exactly as it
 * was and wrote nothing.
 *
 * ⛔ TEST-ONLY, like fake-release.ts: no provider imports it and it is not on the barrel.
 */
import { expect } from 'bun:test';
import type { ReleaseBinaryProps } from './binary-form.ts';
import { reconcileBinary } from './binary-lifecycle.ts';
import {
  ENTERPRISE_URL,
  TRACES_URL,
  VMUTILS_DIR,
  VMUTILS_ENTRIES,
  VMUTILS_URL,
  bytesOf,
  fakeTransport,
  gzip,
  pathsOn,
  releaseHost,
  syntheticRelease,
  tarOf,
  vmalertProps,
} from './fake-release.ts';

export const PATH = `${VMUTILS_DIR}/vmalert`;
export const writes = (fake: ReturnType<typeof releaseHost>) =>
  fake.calls.filter((c) => c[0] === 'write');

/** A host, a synthetic release served at the real URLs (plus an enterprise decoy), and a runner. */
export const setup = (entries = VMUTILS_ENTRIES) => {
  const { catalog, traces, vmutils } = syntheticRelease(entries);
  const decoy = gzip(tarOf([{ bytes: bytesOf('#!enterprise\n'), name: 'vmalert-prod' }]));
  const transport = fakeTransport({
    [ENTERPRISE_URL]: decoy,
    [TRACES_URL]: traces,
    [VMUTILS_URL]: vmutils,
  });
  const fake = releaseHost();
  const props = (more: Partial<ReleaseBinaryProps> = {}) => vmalertProps(catalog, more);
  const install = (declared = props(), options = {}) =>
    reconcileBinary(fake.runner, transport.fetch, declared, options);
  return { fake, install, props, transport };
};

/** Run a refusal; return it, having checked the host is exactly as it was and nothing was written. */
export const refused = async (s: ReturnType<typeof setup>, run: () => Promise<unknown>) => {
  const before = pathsOn(s.fake);
  const error = await run().then(
    () => {
      throw new Error('expected a refusal');
    },
    (cause: unknown) => cause,
  );
  expect(pathsOn(s.fake)).toEqual(before);
  expect(writes(s.fake)).toEqual([]);
  return error as Error;
};
