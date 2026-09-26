/**
 * `Podman.Container`'s read/plan behaviour when a PLAIN unit — never Quadlet's own generator
 * output — already answers to the service name this resource would generate. Split from
 * container-lifecycle.test.ts (see its header) because this is its own, self-contained scenario:
 * container-preflight.ts's `assertUnshadowed`, called from `readContainer`.
 *
 * ★ WHY `readContainer` IS THE RIGHT LEVEL TO TEST. Alchemy's own cold-start adoption probe calls
 *   `provider.read` directly to decide "create" vs "adopted" BEFORE `diff` ever runs (alchemy
 *   beta.79 `Plan.ts` — no state row exists yet, so there is nothing to diff against). Our
 *   provider's `read` (`readHandler`, container-handlers.ts) is a thin wrapper over
 *   `readContainer`, so a refusal here IS the plan refusing, not merely a lower layer.
 */
import { describe, expect, test } from 'bun:test';
import { fakeQuadletHost } from './fake-quadlet.ts';
import type { ContainerProps } from './container-form.ts';
import { readContainer, reconcileContainer } from './container-lifecycle.ts';

const NAME = 'hf-example';
const PATH = `/etc/containers/systemd/${NAME}.container`;
const SERVICE = `${NAME}.service`;
const PLAIN_UNIT_PATH = `/etc/systemd/system/${SERVICE}`;

const props: ContainerProps = {
  container: { image: 'example/one:1', network: 'host' },
  install: { wantedBy: ['multi-user.target'] },
  name: NAME,
  service: { restart: 'always', restartSec: '5s' },
};

/** A unit systemd loaded from somewhere OTHER than Quadlet's own generator — e.g. a PLAIN unit
 *  dropped in `/etc/systemd/system`, the case `assertUnshadowed` exists for. */
const placePlainUnit = (fake: ReturnType<typeof fakeQuadletHost>) =>
  fake.placeUnit(PLAIN_UNIT_PATH, '[Service]\nExecStart=/usr/bin/true\n', { active: true });

describe('a plain unit already answers to the name, and our .container file is absent', () => {
  test('the read refuses instead of reporting the container exists', async () => {
    const fake = fakeQuadletHost();
    placePlainUnit(fake);
    await expect(readContainer(fake.runner, props)).rejects.toThrow(PLAIN_UNIT_PATH);
  });

  test('the refusal names Podman.Container, the unit and the fix — not a generic crash', async () => {
    const fake = fakeQuadletHost();
    placePlainUnit(fake);
    await expect(readContainer(fake.runner, props)).rejects.toThrow(
      /Podman\.Container hf-example:.*hf-example\.service.*plain unit.*move the plain unit aside/is,
    );
  });

  test('nothing was written before the refusal — a plan promises this, it never risks it', async () => {
    const fake = fakeQuadletHost();
    placePlainUnit(fake);
    await expect(readContainer(fake.runner, props)).rejects.toThrow();
    expect(fake.files.has(PATH)).toBe(false);
  });
});

describe('a masked unit keeps its own, more specific refusal', () => {
  test('the read does not report it as a shadowing plain unit', async () => {
    const fake = fakeQuadletHost();
    fake.placeUnit(PLAIN_UNIT_PATH, '[Service]\nExecStart=/usr/bin/true\n', {
      active: false,
      masked: true,
    });
    // Masked still has a real FragmentPath on this fake (measured directly — see
    // container-preflight.ts's `assertUnshadowed`), so this proves the exemption, not an absence.
    const attrs = await readContainer(fake.runner, props);
    expect(attrs).toMatchObject({ loadState: 'masked', name: NAME });
  });

  test('adopting it still refuses, with the masked message, not the shadow one', async () => {
    const fake = fakeQuadletHost();
    fake.placeUnit(PLAIN_UNIT_PATH, '[Service]\nExecStart=/usr/bin/true\n', {
      active: false,
      masked: true,
    });
    await expect(reconcileContainer(fake.runner, props, undefined, true)).rejects.toThrow(
      /is masked/,
    );
  });
});

describe('a real Quadlet generation is unaffected', () => {
  test('FragmentPath under the generator directory still reads as existing', async () => {
    const fake = fakeQuadletHost();
    await reconcileContainer(fake.runner, props, undefined);
    // The source file is gone but the LAST generation is still on disk, unreloaded — exactly what
    // a manual `rm` of the `.container` file leaves behind before the next `daemon-reload`.
    fake.files.delete(PATH);
    const attrs = await readContainer(fake.runner, props);
    expect(attrs).toMatchObject({ containerPath: PATH, name: NAME, serviceName: SERVICE });
  });
});

describe('neither a file nor a unit exists', () => {
  test('read answers undefined, so a plan says create — never a refusal', async () => {
    const fake = fakeQuadletHost();
    expect(await readContainer(fake.runner, props)).toBeUndefined();
  });
});

/**
 * ⛔ REGRESSION FOR A FALSE POSITIVE — found on adversarial review. An earlier version of
 *   `assertUnshadowed` refused for ANY `FragmentPath` not literally under the generator directory,
 *   including a vendor unit at `/usr/lib/systemd/system` — which is LOWER precedence than
 *   Quadlet's generator (`isShadowingFragment`, container-generator.ts, has the measured order), so
 *   writing and reloading our `.container` file would actually win the name, same as any other
 *   cutover from a package-installed daemon to a Podman container. Refusing there blocked exactly
 *   the create/adopt an apply would have handled fine.
 */
describe('a plain unit at a directory LOWER precedence than the generator is not a shadow', () => {
  test('a vendor unit at /usr/lib/systemd/system does not refuse — it reads as adopted', async () => {
    const fake = fakeQuadletHost();
    fake.placeUnit(`/usr/lib/systemd/system/${SERVICE}`, '[Service]\nExecStart=/usr/bin/true\n', {
      active: true,
    });
    const attrs = await readContainer(fake.runner, props);
    expect(attrs).toMatchObject({ name: NAME, serviceName: SERVICE });
  });

  test('a vendor unit at /usr/local/lib/systemd/system does not refuse either', async () => {
    const fake = fakeQuadletHost();
    fake.placeUnit(
      `/usr/local/lib/systemd/system/${SERVICE}`,
      '[Service]\nExecStart=/usr/bin/true\n',
      { active: true },
    );
    const attrs = await readContainer(fake.runner, props);
    expect(attrs).toMatchObject({ name: NAME, serviceName: SERVICE });
  });
});
