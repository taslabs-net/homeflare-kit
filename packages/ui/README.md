# @homeflare/ui

React components built on [Cloudflare Kumo](https://github.com/cloudflare/kumo).

> ⚠️ **Scaffold. Not ready for adoption.** This package currently exports only `VERSION`.
> It ships no components, no theme, and no stylesheet, and it does not re-export Kumo —
> so today it centralises nothing. Use Kumo directly (below) until this says otherwise.

## Use Kumo directly for now

```sh
bun add @cloudflare/kumo react react-dom @phosphor-icons/react zod echarts
```

```ts
import '@cloudflare/kumo/styles'; // once, at your app root
import { Button } from '@cloudflare/kumo/components/button';
```

⚠️ Import from the per-component subpaths, not the root: the root entry pulls all 44
components into the module graph, so an app that uses a Button ships the chart library.

Kumo peers: `react` 18 or 19 · `react-dom` · `@phosphor-icons/react` · `zod` ^4 ·
`echarts` ^6. It brings its own stylesheet — no Tailwind preset is required.

## Scope

⛔ **Browser and React surfaces only.** Most projects in this family are Workers, scripts
or servers, and need nothing from here. Kumo is not a default for every project.

⛔ **shadcn/Radix are deliberately absent.** Kumo already occupies that layer, on Base UI.
Taking both would mean two primitive libraries, two styling conventions and two
accessibility models in one app.

## What this package will hold

HomeFlare-specific **compositions** of Kumo parts — never reimplementations of them —
plus a shared theme once two apps actually need the same one. It stays a scaffold until
that second app exists, because the shape should be decided by real use rather than
guessed here.

## License

MIT © Timothy Schneider
