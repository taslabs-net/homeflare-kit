---
'@homeflare/kit': minor
'@homeflare/alchemy': minor
---

Ship the HTTP and Website SDK surfaces apps were hand-rolling.

**`@homeflare/kit/openapi`** — `createOpenApiApp()` is OpenAPIHono with one
readable validation hook. The document and the request share a Zod schema.
Subpath, not the main entry: a Node script that only wants `parseEnv` must not
resolve Hono. Peers: `hono`, `@hono/zod-openapi`, `zod` (optional). Import `z`
from `@hono/zod-openapi`.

**`astroWebsite` / `viteWebsite`** on `@homeflare/alchemy/cloudflare` — house
flags on Alchemy's own stacks. Astro gets `disable_nodejs_process_v2` (workerd
process-v2 returns `[object Object]`). Vite is TanStack Start / static Vite.
Not Nextjs: that helper hashes source and plans as create against a live Worker.

Catalog also pins `@tanstack/react-router` 1.170.35, `@tanstack/react-start`
1.168.52, `@tanstack/react-query` 5.102.8 — match these, do not wrap them.
