/**
 * Guards against a real estate identifier leaking into this PUBLIC package's source.
 *
 * homeflare-kit is public (`gh repo view taslabs-net/homeflare-kit --json isPrivate`
 * → isPrivate:false, checked 2026-09-23); the real Cloudflare AI Gateway id
 * `homeflare-ai-gateway` lives only in the PRIVATE homeflare-landscape repo
 * (plugins/homeflare-workflows/skills/typesafe-ai/references/ai-gateway.md). This
 * package's own file-header rule is explicit: "Name no estate account, gateway id,
 * env-file path or hostname (the package is public)." Fixtures and docs use the
 * placeholder `example-gateway` (see gateway-fixtures.ts) instead.
 *
 * Scans every source and script file actually published or run from this package —
 * not just the two files known to have leaked it — so a future reintroduction here
 * fails the same way.
 */
import { readdir } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';

const REAL_GATEWAY_ID = 'homeflare-ai-gateway';

async function listFiles(dirUrl: URL): Promise<URL[]> {
  const entries = await readdir(dirUrl, { withFileTypes: true }).catch(() => []);
  const out: URL[] = [];
  for (const entry of entries) {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(childUrl)));
    } else if (/\.(ts|md)$/.test(entry.name)) {
      // Keep the URL object itself — Bun.file(string) treats a "file://…" string as
      // a literal path, not a URL, and silently fails to find the file.
      out.push(childUrl);
    }
  }
  return out;
}

describe('no real estate gateway id in the public package', () => {
  test('src/ and scripts/ never name the real gateway id', async () => {
    const files = [
      ...(await listFiles(new URL('../src/', import.meta.url))),
      ...(await listFiles(new URL('../scripts/', import.meta.url))),
    ];
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const fileUrl of files) {
      const text = await Bun.file(fileUrl).text();
      if (text.includes(REAL_GATEWAY_ID)) offenders.push(fileUrl.href);
    }

    expect(offenders).toEqual([]);
  });
});
