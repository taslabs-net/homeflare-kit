/**
 * The secret refusal the task asks to be proven, not merely implemented: no secret can appear in
 * the RENDERED file or in Alchemy STATE. `secretLikeEnvironment` is the detector; this file also
 * proves the whole path is wired — `containerProblems` calls it, and `reconcileContainer` refuses
 * BEFORE any write, so a secret-shaped `Environment=` never reaches the fake filesystem (which is
 * what a real deploy's `writeFileAtomic` and Alchemy's state row both stand in for here).
 */
import { describe, expect, test } from 'bun:test';
import { podmanArgsProblems, secretLikeEnvironment, secretLikeLines } from './container-secrets.ts';
import { type ContainerProps, containerProblems, renderContainerFile } from './container-form.ts';
import { fakeQuadletHost } from './fake-quadlet.ts';
import { reconcileContainer } from './container-lifecycle.ts';

describe('secretLikeEnvironment', () => {
  test('a key name that says what it holds is refused', () => {
    const found = secretLikeEnvironment({
      API_TOKEN: 'x',
      DB_PASSWORD: 'y',
      GRAFANA_SECRET_KEY: 'z',
    });
    expect(found).toHaveLength(3);
    expect(found.join(' ')).toMatch(/looks like a secret by its name/);
  });

  test('an ordinary config key is left alone', () => {
    expect(
      secretLikeEnvironment({ CADDY_CONFIG: '/etc/caddy/Caddyfile', GF_SERVER_DOMAIN: 'x' }),
    ).toEqual([]);
  });

  test('a value shaped like a real vendor token is refused even under an innocuous key name', () => {
    const found = secretLikeEnvironment({ EXTRA_ARGS: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    expect(found.join(' ')).toMatch(/looks like a credential/);
  });

  test('a bearer/basic auth header value is refused', () => {
    expect(secretLikeEnvironment({ HEADER: 'Bearer sometoken' })).toHaveLength(1);
  });
});

describe('a secret-shaped Environment= is refused before anything touches the host', () => {
  const NAME = 'hf-example';

  const withSecret: ContainerProps = {
    container: {
      environment: { GF_SECURITY_ADMIN_PASSWORD: 'hunter2' },
      image: 'grafana/grafana:12',
    },
    name: NAME,
  };

  test('containerProblems names the offending key', () => {
    expect(containerProblems(withSecret).join(' ')).toMatch(/GF_SECURITY_ADMIN_PASSWORD/);
  });

  test('reconcile refuses and writes nothing — not the file, not a generated unit', async () => {
    const fake = fakeQuadletHost();
    await expect(reconcileContainer(fake.runner, withSecret, undefined)).rejects.toThrow(
      /GF_SECURITY_ADMIN_PASSWORD/,
    );
    expect(fake.calls).toHaveLength(0);
    expect(fake.files.has(`/etc/containers/systemd/${NAME}.container`)).toBe(false);
  });

  test('the renderer alone does not filter secrets — validation is the only backstop', () => {
    // ★ `renderContainerFile` is a pure formatter; it does not know what a secret looks like.
    //   `containerProblems`/`assertValid` do, and the previous test proves `reconcileContainer`
    //   calls one before any write. This is why that ordering is load-bearing: called on its own,
    //   the renderer WOULD put the secret in the file — there is no second, independent filter.
    expect(renderContainerFile(withSecret)).toContain('hunter2');
  });
});

// ⛔ FOUND ON ADVERSARIAL REVIEW: `container.environment` was the only field checked. `exec`,
//   `podmanArgs` and the `unit.lines`/`service.lines` escape hatches all render into the same
//   0644 file and the same state row, unchecked. These prove the fix closes every one of them.
describe('secretLikeLines — every OTHER rendered field', () => {
  test('a value shaped like a vendor token is refused, wherever it sits in the line', () => {
    const found = secretLikeLines([
      ['Exec', 'sh -c "curl -H \'X: ghp_abcdefghijklmnopqrstuvwxyz0123\'"'],
    ]);
    expect(found.join(' ')).toMatch(/looks like it carries a credential/);
  });

  test('an embedded KEY=VALUE whose key looks secret is refused even with no known token shape', () => {
    const found = secretLikeLines([['PodmanArgs', 'GITHUB_TOKEN=some-opaque-value']]);
    expect(found.join(' ')).toMatch(/embeds a KEY=VALUE pair whose key looks like a secret/);
  });

  test('a raw systemd Environment= line is caught even though it never touches the typed map', () => {
    const found = secretLikeLines([['Environment', 'DB_PASSWORD=hunter2']]);
    expect(found).toHaveLength(1);
  });

  test('an ordinary line is left alone', () => {
    expect(
      secretLikeLines([
        ['Description', 'the shared postgres'],
        ['WantedBy', 'multi-user.target'],
      ]),
    ).toEqual([]);
  });
});

describe('podmanArgsProblems — an env flag is refused outright', () => {
  test('-e and --env, split or `=`-joined or glued, are all caught', () => {
    for (const args of [
      ['-e', 'FOO=bar'],
      ['--env', 'FOO=bar'],
      ['--env=FOO=bar'],
      ['-eFOO=bar'],
    ]) {
      expect(podmanArgsProblems(args).length).toBeGreaterThan(0);
    }
  });

  test('an unrelated arg is left alone', () => {
    expect(podmanArgsProblems(['--pull=never', '--cgroups=split'])).toEqual([]);
  });
});

describe('containerProblems catches a secret smuggled through every free-text field', () => {
  const base = { container: { image: 'grafana/grafana:12', network: 'host' }, name: 'hf-example' };

  test('exec', () => {
    const problems = containerProblems({
      ...base,
      container: { ...base.container, exec: 'sh -c "export API_TOKEN=hunter2 && run"' },
    });
    expect(problems.join(' ')).toMatch(/embeds a KEY=VALUE pair/);
  });

  test('podmanArgs — the outright -e/--env refusal fires before the shape check even runs', () => {
    const problems = containerProblems({
      ...base,
      container: {
        ...base.container,
        podmanArgs: ['-e', 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123'],
      },
    });
    expect(problems.join(' ')).toMatch(/sets a container environment variable outside/);
  });

  test('unit.lines', () => {
    const problems = containerProblems({
      ...base,
      unit: { lines: [['X-Note', 'token: ghp_abcdefghijklmnopqrstuvwxyz0123']] },
    });
    expect(problems.join(' ')).toMatch(/looks like it carries a credential/);
  });

  test('service.lines — a raw systemd Environment=, bypassing the typed map entirely', () => {
    const problems = containerProblems({
      ...base,
      service: { lines: [['Environment', 'CLIENT_SECRET=abc123']] },
    });
    expect(problems.join(' ')).toMatch(/embeds a KEY=VALUE pair/);
  });

  test('reconcile refuses a podmanArgs secret before anything touches the host', async () => {
    const fake = fakeQuadletHost();
    const withArgSecret: ContainerProps = {
      ...base,
      container: { ...base.container, podmanArgs: ['-e', 'DB_PASSWORD=hunter2'] },
    };
    await expect(reconcileContainer(fake.runner, withArgSecret, undefined)).rejects.toThrow(
      /environment variable outside/,
    );
    expect(fake.calls).toHaveLength(0);
  });
});
