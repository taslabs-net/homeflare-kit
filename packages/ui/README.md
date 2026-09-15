# @homeflare/ui

HomeFlare brand tokens and shared compositions for apps built on
[Cloudflare Kumo](https://github.com/cloudflare/kumo).

```sh
bun add @homeflare/ui @cloudflare/kumo react react-dom @phosphor-icons/react
```

⛔ **Browser and React surfaces only.** Workers, scripts and servers need nothing here —
they want [`@homeflare/kit`](https://www.npmjs.com/package/@homeflare/kit).

## Kumo is a peer, not a re-export

Import Kumo's components **directly and granularly**:

```tsx
import { Button } from '@cloudflare/kumo/components/button';
import { Dialog } from '@cloudflare/kumo/components/dialog';
```

★ This package does **not** re-export them. A barrel would pull all 44 components into the
module graph, so an app using a Button would ship the chart library — which is exactly why
Kumo documents the per-component subpaths.

⚠️ Because you import Kumo directly, **you declare it**. It is a peer here so that one
copy wins; a dependency would let two versions coexist, meaning two stylesheets and two
Base UI instances in one tree.

Peers: `@cloudflare/kumo` ^2.13.2 · `react` 18 or 19 · `react-dom`.
Kumo's own peers: `@phosphor-icons/react`, plus `zod` and `echarts` — both **optional**,
needed only by the components that use them.

## Styles

```ts
import '@homeflare/ui/styles'; // once, at your app root
```

Kumo's stylesheet plus HomeFlare tokens (`--hf-radius-card`, `--hf-shell-max-width`,
`--hf-gutter`). It replaces `import '@cloudflare/kumo/styles'` — importing both is
harmless but redundant.

⛔ **Opt-in, never automatic.** The JS entrypoint imports no CSS, because a library that
does so on your behalf breaks any consumer whose bundler cannot handle CSS imports.

### Next.js (App Router)

```tsx
// app/layout.tsx
import '@homeflare/ui/styles';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

⚠️ Import it in the **root layout**, not in a client component: a CSS import inside a
`'use client'` module loads per route rather than once.

### Vite / TanStack Start

```tsx
// src/main.tsx — or the root route module in TanStack Start
import '@homeflare/ui/styles';
import { createRoot } from 'react-dom/client';
```

No plugin or Tailwind preset is required; Kumo ships plain CSS.

## What lands here

Compositions of Kumo parts that **more than one** app needs — never reimplementations. If
Kumo has it, use Kumo's.

⛔ shadcn and Radix stay out: Kumo already occupies that layer, on Base UI. Taking both
means two primitive libraries, two styling conventions and two accessibility models.

## License

MIT © Timothy Schneider
