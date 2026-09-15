---
'@homeflare/ui': minor
'@homeflare/kit': patch
'@homeflare/cloudflare': patch
'@homeflare/auth': patch
'@homeflare/config': patch
---

Ship the real HomeFlare theme, and stop publishing broken commands.

**The packaging defect (all five packages).** An installed `@homeflare/ui@0.2.0`
advertised `bun run smoke`, which exited 1 with "Module not found scripts/smoke.ts" —
`build` and `types` were equally broken, since `tsconfig.build.json` does not ship either.
Dev scripts and devDependencies are now stripped at pack time, so the published manifest
offers only what the tarball can run.

★ The pack path is now shared between the release and the smoke tests. When they differed,
the gate inspected a different tarball from the one consumers received, which is exactly
how this got out.

**The theme.** `@homeflare/ui/styles` shipped stock Kumo — whose brand is **blue** —
rather than HomeFlare orange. The theme now lives as data in `theme/homeflare.yaml`, with
both the stylesheet and a new `@homeflare/ui/theme` module generated from it:

```ts
import { ACCENT, ACCENT_INK } from '@homeflare/ui/theme';
```

⛔ `ACCENT_INK` is the contrast-safe text colour. `#f6821f` on a light background fails
WCAG AA at body sizes, so orange text must never use the raw accent.

★ Why data and not just CSS: `#f6821f` is hardcoded in 37 files across the estate, and
many are TSX — OG-image routes, admin widgets, email templates — which a stylesheet cannot
reach. Parsed with `Bun.YAML.parse`, so no dependency is added.

Also adds `@homeflare/ui/styles/tailwind` for apps that use Tailwind alongside Kumo.
