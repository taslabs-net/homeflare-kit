/**
 * `renderContainerFile`/`containerPathFor` are reachable from the package entry — the same pure
 * `.container` renderer `container-fixture.test.ts` (container-form.ts) already proves internally,
 * now callable by a CONSUMER without a deep import.
 *
 * ★ WHY THIS WAS MISSING. `index.ts`'s barrel forwarded `QUADLET_DEFAULT_DIRECTORY`/
 *   `QUADLET_SEARCH_DIRECTORIES` (constants) but not the renderer or the path rule, unlike
 *   `Systemd.Unit`'s own pure helpers (`renderUnit`/`DEFAULT_UNIT_DIRECTORY`), which ARE both on
 *   the barrel. A consumer (homeflare-ct100 PR #1) writing an equivalence test against a live
 *   host — the same kind of test this package's own fixture tests are — had no import path to
 *   the real renderer and had to reimplement the render contract by hand to write one at all.
 */
import { expect, test } from 'bun:test';
import { containerPathFor, renderContainerFile } from './index.ts';

test('renderContainerFile and containerPathFor are reachable from the package entry', () => {
  const rendered = renderContainerFile({
    container: { image: 'docker.io/library/busybox:1', network: 'host' },
    name: 'smoke',
  });
  expect(rendered).toContain('[Container]');
  expect(rendered).toContain('Image=docker.io/library/busybox:1');
  expect(rendered).toContain('Network=host');
  expect(containerPathFor({ name: 'smoke' })).toBe('/etc/containers/systemd/smoke.container');
});
