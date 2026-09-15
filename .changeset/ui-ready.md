---
'@homeflare/ui': minor
---

Make the package ready for consistent Kumo adoption.

**Breaking for anyone who installed 0.1.0** (nobody has — it exported only `VERSION`):
`@cloudflare/kumo` moves from a dependency to a **peer**. Consumers import Kumo directly
and granularly, so one copy must win; a dependency would let two versions coexist, meaning
two stylesheets and two Base UI instances in one tree.

- **`@homeflare/ui/styles`** — an opt-in CSS export: Kumo's stylesheet plus HomeFlare
  brand tokens (`--hf-radius-card`, `--hf-shell-max-width`, `--hf-gutter`). The JS
  entrypoint still imports no CSS, so a Worker or SSR pass can load this module safely.
- **Kumo stays granular.** Nothing is wrapped or re-exported: import from
  `@cloudflare/kumo/components/*` as Kumo documents.
- **Dropped `zod` and `echarts` as required peers** — Kumo marks both optional, so
  requiring them made every consumer install a chart library to render a Button.
- **Corrected the entrypoint comment** that claimed Kumo was re-exported when it was not.
- **README** with Next.js App Router and Vite/TanStack Start examples.
- **Real smoke test**, replacing a script that echoed and exited 0. It packs the tarball,
  installs it beside Kumo, and proves JS resolution, the CSS export, consumer-side
  typechecking, and that a Kumo component renders to HTML.
