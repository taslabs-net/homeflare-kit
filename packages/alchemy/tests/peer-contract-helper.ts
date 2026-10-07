export type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export async function* workspacePackages(
  root: URL,
  pattern: string,
): AsyncGenerator<{ name: string | undefined; path: string; manifest: PackageJson }> {
  const glob = new Bun.Glob(pattern);
  for await (const relative of glob.scan({ cwd: root.pathname })) {
    const manifest = (await Bun.file(new URL(relative, root)).json()) as PackageJson;
    yield { name: manifest.name, path: relative, manifest };
  }
}

/** Extract the PINS object from the smoke script as a plain record. */
export function parseSmokePins(smoke: string): Record<string, string> {
  const block = smoke.match(/const PINS\s*=\s*\{([^]*?)\n\}\s*;/)?.[1];
  if (block === undefined) {
    throw new Error('PINS block not found in smoke script');
  }
  const out: Record<string, string> = {};
  for (const [, unquoted, quoted, value] of block.matchAll(
    /^\s*(?:([A-Za-z0-9_]+)|'([^']+)')\s*:\s*'([^']+)'/gm,
  )) {
    const key = unquoted ?? quoted;
    if (key !== undefined && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** Extract the name@version pairs from the smoke script's `bun add` install call. */
export function parseSmokeInstallPins(smoke: string): Record<string, string> {
  const call = smoke.match(
    /await\s+run\s*\(\s*\[\s*'bun'\s*,\s*'add'[\s\S]*?\]\s*,\s*scratch\s*,\s*\)/,
  );
  if (call?.[0] === undefined) {
    throw new Error('smoke install call not found');
  }

  const out: Record<string, string> = {};
  for (const [, quoted] of call[0].matchAll(/'([^']+)'/g)) {
    if (quoted === undefined) {
      continue;
    }
    const parts = quoted.split('@');
    if (parts.length >= 2) {
      const version = parts.pop();
      const name = parts.join('@');
      if (version !== undefined) {
        out[name] = version;
      }
    }
  }
  return out;
}

/**
 * One published import move: the `effect/unstable/*` specifier to rewrite, and where it
 * goes. The kit publishes these as an ordered ARRAY of these objects, never an object
 * keyed by the old path.
 */
export interface ImportMove {
  readonly from: string;
  readonly to: string;
}

/** Derive import moves from the rc.115 unstable exports to the installed effect exports. */
export function deriveImportMoves(
  rcExports: Record<string, unknown>,
  effectExports: { exports: Record<string, unknown> },
): { importMoves: ImportMove[]; unresolved: string[] } {
  const rcUnstable = Object.keys(rcExports)
    .filter((k) => k.startsWith('./unstable/') && !k.includes('/internal/'))
    .map((k) => k.slice('./unstable/'.length));

  const exportKeys = Object.keys(effectExports.exports).filter(
    (k) => typeof effectExports.exports[k] === 'string' && k.startsWith('./') && !k.includes('*'),
  );
  const exact = new Set(exportKeys.map((k) => k.slice(2)));
  const dehyphen = new Map(exportKeys.map((k) => [k.slice(2).replace(/-/g, ''), k.slice(2)]));

  const moves: ImportMove[] = [];
  const unresolved: string[] = [];

  for (const area of rcUnstable) {
    if (exact.has(area)) {
      moves.push({ from: `effect/unstable/${area}/`, to: `effect/${area}/` });
    } else {
      const target = dehyphen.get(area.replace(/-/g, ''));
      if (target !== undefined) {
        moves.push({ from: `effect/unstable/${area}/`, to: `effect/${target}/` });
      } else {
        unresolved.push(`effect/unstable/${area}/`);
      }
    }
  }

  // Preserve the contract's ordering: httpapi first, then alphabetical. Consumers apply
  // the moves in published order, so `httpapi` must precede its parent `http` — a looser
  // rewrite of `effect/unstable/http` would otherwise corrupt `effect/unstable/httpapi/`.
  // Array#sort is stable, so this is deterministic for equal keys.
  const httpapiFrom = 'effect/unstable/httpapi/';
  moves.sort((a, b) => {
    if (a.from === httpapiFrom) return -1;
    if (b.from === httpapiFrom) return 1;
    return a.from < b.from ? -1 : a.from > b.from ? 1 : 0;
  });

  return { importMoves: moves, unresolved };
}
