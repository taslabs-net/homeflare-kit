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

    // bun resolves the protocols; npm carries the provenance attestation.
    expect(src).toContain("'bun', 'pm', 'pack'");
    expect(src).toContain("'--provenance'");
    // ⛔ Conditional on CI, never dropped: provenance cannot be minted on a laptop
    //   (no OIDC identity), but a release FROM CI must always be attested.
    expect(src).toContain('GITHUB_ACTIONS');
  });

  test('skips versions already on the registry, so a partial release can be finished', async () => {
    const src = await Bun.file(new URL('scripts/publish.ts', root)).text();

    expect(src).toContain('isPublished');
  });
});
