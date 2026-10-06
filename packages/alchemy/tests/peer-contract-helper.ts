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

/** Derive import moves from the rc.115 unstable exports to the installed effect exports. */
export function deriveImportMoves(
  rcExports: Record<string, unknown>,
  effectExports: { exports: Record<string, unknown> },
): { importMoves: Record<string, string>; unresolved: string[] } {
  const rcUnstable = Object.keys(rcExports)
    .filter((k) => k.startsWith('./unstable/') && !k.includes('/internal/'))
    .map((k) => k.slice('./unstable/'.length));

  const exportKeys = Object.keys(effectExports.exports).filter(
    (k) => typeof effectExports.exports[k] === 'string' && k.startsWith('./') && !k.includes('*'),
  );
  const exact = new Set(exportKeys.map((k) => k.slice(2)));
  const dehyphen = new Map(exportKeys.map((k) => [k.slice(2).replace(/-/g, ''), k.slice(2)]));

  const moves: Record<string, string> = {};
  const unresolved: string[] = [];

  for (const area of rcUnstable) {
    if (exact.has(area)) {
      moves[`effect/unstable/${area}/`] = `effect/${area}/`;
    } else {
      const target = dehyphen.get(area.replace(/-/g, ''));
      if (target !== undefined) {
        moves[`effect/unstable/${area}/`] = `effect/${target}/`;
      } else {
        unresolved.push(`effect/unstable/${area}/`);
      }
    }
  }

  // Preserve the contract's ordering: httpapi first, then alphabetical.
  const httpapiKey = 'effect/unstable/httpapi/';
  const ordered: Record<string, string> =
    moves[httpapiKey] === undefined ? {} : { [httpapiKey]: moves[httpapiKey] };
  for (const key of Object.keys(moves)
    .filter((k) => k !== httpapiKey)
    .sort()) {
    const value = moves[key];
    if (value !== undefined) {
      ordered[key] = value;
    }
  }

  return { importMoves: ordered, unresolved };
}
