/**
 * Guards the publish path.
 *
 * ⛔ THE BUG THIS EXISTS FOR, MEASURED 2026-09-15. `changeset publish` shells out to
 *   `npm publish`, and `npm pack` resolves NEITHER protocol bun uses:
 *     `workspace:*` ships literally -> the consumer's install fails outright
 *     `catalog:`    ships literally -> EUNSUPPORTEDPROTOCOL
 *   Both are open upstream bugs (bun#24687, changesets/action#246, changesets#2213).
 *   `bun pm pack` resolves both, so the release packs with bun and publishes that
 *   tarball with npm — which also keeps --provenance, a flag `bun publish` lacks.
 */
import { describe, expect, test } from 'bun:test';

const root = new URL('../', import.meta.url);

describe('release', () => {
  test('does NOT use changeset publish', async () => {
    const pkg = (await Bun.file(new URL('package.json', root)).json()) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts['release']).not.toContain('changeset publish');
    expect(pkg.scripts['release']).toContain('scripts/publish.ts');
  });

  test('the publish script packs with bun and publishes with npm', async () => {
    const src = await Bun.file(new URL('scripts/publish.ts', root)).text();

    // ★ The pack itself moved to scripts/pack.ts, shared with the smoke tests so the
    //   tarball a gate inspects is the tarball a consumer receives. When they differed,
    //   the release stripped dev scripts and the smoke test did not — so @homeflare/ui
    //   published a manifest advertising `bun run smoke`, whose file never shipped.
    expect(src).toContain('packForPublish');

    const pack = await Bun.file(new URL('scripts/pack.ts', root)).text();
    expect(pack).toContain("'bun', 'pm', 'pack'");
    // ⛔ Dev scripts must not reach the tarball: they reference files it does not carry.
    expect(pack).toContain("delete packed['scripts']");
    expect(pack).toContain("delete packed['devDependencies']");
    // 🔴 AND THE STRIP HAPPENS INSIDE THE TARBALL, NEVER ON DISK. Editing the real
    //   manifest is a race that destroyed one: two smoke tests pack @homeflare/kit
    //   concurrently, and the second restored the already-stripped copy it had read.
    //   tests/pack-purity.test.ts proves the property; this pins the mechanism.
    expect(pack).toContain('stripScriptsInTarball');
    expect(pack).not.toContain('Bun.write(manifestPath');
    expect(src).toContain("'--provenance'");
    // ⛔ Conditional on CI, never dropped: provenance cannot be minted on a laptop
    //   (no OIDC identity), but a release FROM CI must always be attested.
    expect(src).toContain('GITHUB_ACTIONS');
  });

  test('emits CHANGESETS_OUTPUT so tags and GitHub releases get created', async () => {
    // ⛔ THE GAP THIS CLOSES, measured 2026-09-15. With a custom publish-script,
    //   changesets/action learns what shipped ONLY from this ndjson file. Without it the
    //   action warns and creates nothing: npm had 0.1.0 and 0.1.1 while GitHub's Releases
    //   page stayed empty, as if the project had never cut a release.
    const src = await Bun.file(new URL('scripts/publish.ts', root)).text();

    expect(src).toContain('CHANGESETS_OUTPUT');
    expect(src).toContain("type: 'git-tag'");
  });

  test('a slow registry never aborts the release', async () => {
    // ⚠️ THE FALSE ALARM THIS PREVENTS, measured 2026-09-15. npm prints "Your package is
    //   being processed and may take a few minutes to become available" — a publish is
    //   ACCEPTED before it is READABLE. The first version of the check ran `npm view` one
    //   second after a successful, provenance-signed publish, got a 404, aborted the
    //   release, and left four packages unpublished.
    const src = await Bun.file(new URL('scripts/publish.ts', root)).text();

    // ⚠️ MEASURED TWICE, and it cost two releases: failing on an immediate 404, then
    //   failing after a 60s poll. Both packages were fine. A publish npm ACCEPTED must
    //   never stop the remaining packages — that turns CDN lag into a half-released
    //   workspace, which is worse than the problem the check was added for.
    expect(src).not.toContain('npm exited 0 but the registry');
  });

  test('refreshes the lockfile before packing', async () => {
    // ⛔ THE BUG THIS CATCHES, measured 2026-09-15 against the real version PR.
    //   `bun pm pack` reads the workspace version from bun.lock, not from the sibling
    //   package.json — so after a version bump it packs a dependency on the OLD version,
    //   which does not exist on the registry. Neither `bun install` nor `--force`
    //   rewrote the entry; only regenerating the lockfile did.
    const src = await Bun.file(new URL('scripts/publish.ts', root)).text();

    expect(src).toContain('bun.lock');
    expect(src).toContain("'bun', 'install'");
  });

  test('skips versions already on the registry, so a partial release can be finished', async () => {
    const src = await Bun.file(new URL('scripts/publish.ts', root)).text();

    expect(src).toContain('isPublished');
  });
});
