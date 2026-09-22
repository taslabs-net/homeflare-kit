/**
 * The rename a plan sees while `content` is still an Output. `diffHandler` cannot run `diffUnit`
 * there, but it still plans a delete-first replace — so the refusals that need only the new NAME
 * have to fire in the plan, before Alchemy stops and removes the old unit.
 *
 * ★ The fully resolved rename is unit-preflight.test.ts. 🔴 Found by review (2026-09-22): this
 *   branch returned the replace with no check at all.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { fakeLinuxHost } from './fake-linux-host.ts';
import { renderUnit } from './unit-form.ts';
import { diffHandler } from './unit-handlers.ts';
import { diffUnit, reconcileUnit } from './unit-lifecycle.ts';

const NAME = 'hf-example.service';
const PATH = `/etc/systemd/system/${NAME}`;
const RENAMED = 'hf-renamed.service';
const RENAMED_PATH = `/etc/systemd/system/${RENAMED}`;
const body = (exec: string) =>
  renderUnit([
    { lines: [['Description', 'example']], name: 'Unit' },
    { lines: [['ExecStart', exec]], name: 'Service' },
    { lines: [['WantedBy', 'multi-user.target']], name: 'Install' },
  ]);

const props = { content: body('/usr/bin/example'), name: NAME };
// ★ An Effect is what isResolved() calls unresolved — the stand-in for a rendered digest.
const pending = { content: Effect.succeed(props.content), name: RENAMED } as never;

const running = async () => {
  const fake = fakeLinuxHost({ dirs: { '/etc/systemd/system': 0 } });
  const output = await reconcileUnit(fake.runner, props, undefined);
  return { fake, output, writes: () => fake.calls.filter((call) => call[0] === 'write').length };
};

describe('a rename while content is still an Output', () => {
  test('a free name plans a delete-first replace and writes nothing', async () => {
    const { fake, output, writes } = await running();
    const before = writes();
    const diff = await Effect.runPromise(diffHandler(fake.runner, 'id', pending, output));
    expect(diff).toEqual({ action: 'replace', deleteFirst: true });
    expect(writes()).toBe(before);
  });

  test('a MASKED target is refused by the plan, with the old unit still running', async () => {
    const { fake, output } = await running();
    fake.placeUnit(RENAMED_PATH, body('/usr/bin/other'), { masked: true });
    await expect(
      Effect.runPromise(diffHandler(fake.runner, 'id', pending, output)),
    ).rejects.toThrow(/is masked/);
    expect(fake.units.get(NAME)?.active).toBe(true);
    expect(fake.files.has(PATH)).toBe(true);
  });

  test('an unprivileged runner is refused before anything is removed', async () => {
    const { fake, output } = await running();
    const unprivileged = { ...fake.runner, effectiveUid: () => 1001, privileged: false };
    await expect(
      Effect.runPromise(diffHandler(unprivileged, 'id', pending, output)),
    ).rejects.toThrow(/never calls sudo/);
    expect(fake.units.get(NAME)?.active).toBe(true);
  });
});

describe('a resolved rename', () => {
  test('is read-only: the plan writes nothing, whatever it decided', async () => {
    const { fake, output, writes } = await running();
    const before = writes();
    expect(await diffUnit(fake.runner, { ...props, name: RENAMED }, output)).toEqual({
      action: 'replace',
      deleteFirst: true,
    });
    expect(writes()).toBe(before);
  });
});
