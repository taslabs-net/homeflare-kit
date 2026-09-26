/**
 * B0a / T12 static guard: no file under `src/unifi` may reference an SDK write operation — a
 * check that travels with the DIRECTORY, not with today's two-family knowledge of what those
 * operations are named. `resource.ts`'s engine and `policy.ts`'s refusal never call one today;
 * nothing in the TYPE SYSTEM stops a future family file from importing, say,
 * `unifi_devices.adoptDevice` and calling it directly, bypassing `unifiOperations` altogether.
 * `GetOnlyHttpClient` (`resource.ts`) is the runtime backstop if one ever did; this is the
 * static one, so the mistake is caught at test time instead of by a wire-level defect.
 *
 * ⛔ SCOPED TO THE SDK's OWN NAMESPACE, NOT EVERY OCCURRENCE OF THE WORD. Alchemy's OWN `adopt()`
 *   (`import { adopt } from 'alchemy/AdoptPolicy'`, used by `network.ts`/`firewall-zone.ts`) is a
 *   declarative "bind to an existing object" flag, not a vendor write call — and `policy.ts`'s
 *   `UnifiWriteAction` type plus `refuseWrite(..., 'delete')`'s string literals NAME a refused
 *   action, they do not reference one. Both would false-positive a bare word search. This test
 *   only flags `<alias>.<verb...>` property access, or a named import, where `<alias>`/the import
 *   specifier resolves to `@distilled.cloud/unifi-network/*` — never Alchemy's own helpers, and
 *   never an English sentence that happens to start the same way.
 * ⚠️ BLOCK COMMENTS ARE STRIPPED FIRST. `network.ts`'s and `network-form.ts`'s own trap warnings
 *   intentionally quote `updateNetwork`/`createNetwork` in prose (documenting what NOT to call) —
 *   without stripping `/** ... *\/` blocks first, this test would fail on its own documentation.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const DIR = dirname(SELF);
const SDK_IMPORT_PREFIX = '@distilled.cloud/unifi-network/';
const BANNED_VERBS = ['create', 'update', 'delete', 'patch', 'execute', 'remove', 'adopt'];
// Matches a bare verb or a verb-led camelCase SDK op name (`deleteFirewallZone`, `adoptDevice`) —
// never a longer English word that merely starts the same way (`removes`, `updated`, `deletion`).
const WRITE_OP_NAME = new RegExp(`^(?:${BANNED_VERBS.join('|')})(?:[A-Z][A-Za-z0-9]*)?$`);
const IMPORT_RE =
  /import\s+(?:type\s+)?(?:\*\s+as\s+(\w+)|\{([^}]*)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;

const stripBlockComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ');

const sourceFiles = () =>
  readdirSync(DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(DIR, name))
    // ⚠️ SKIPS ITS OWN FILE. `offensesIn`'s "DOES flag a real reference" test below embeds
    //   deliberately-bad snippets (`networks.deleteNetwork(...)`, an `updateFirewallZone` named
    //   import) as STRING literals to prove the scanner catches them -- scanning this file's own
    //   raw text would flag those fixtures as if they were live code and fail on itself.
    .filter((path) => path !== SELF);

/** Every `import ... from '@distilled.cloud/unifi-network/<module>'` in one file. */
const sdkImports = (src: string) => {
  const found: { alias: string | undefined; named: string[] }[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const [, nsAlias, namedList, defaultAlias, specifier] = m;
    // `specifier` (the 4th capture group) is never optional in IMPORT_RE, but `tsc` cannot see
    // that through `matchAll`'s `string | undefined` element type -- skip rather than assert.
    if (specifier === undefined || !specifier.startsWith(SDK_IMPORT_PREFIX)) continue;
    const named = namedList
      ? namedList
          .split(',')
          .map((n) =>
            (
              n
                .trim()
                .replace(/^type\s+/, '')
                .split(/\s+as\s+/)
                .at(-1) ?? ''
            ).trim(),
          )
          .filter(Boolean)
      : [];
    found.push({ alias: nsAlias ?? defaultAlias, named });
  }
  return found;
};

/** Every offense in one already comment-stripped source file: `path: reason`. */
const offensesIn = (path: string, src: string): string[] => {
  const offenses: string[] = [];
  for (const { alias, named } of sdkImports(src)) {
    for (const name of named) {
      if (WRITE_OP_NAME.test(name)) offenses.push(`${path}: named-imports SDK op '${name}'`);
    }
    if (alias === undefined) continue;
    for (const m of src.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))) {
      const propertyName = m[1];
      if (propertyName !== undefined && WRITE_OP_NAME.test(propertyName)) {
        offenses.push(`${path}: references '${alias}.${propertyName}'`);
      }
    }
  }
  return offenses;
};

describe('src/unifi never references an SDK write operation (T12)', () => {
  test('every source file is clean of create|update|delete|patch|execute|remove|adopt SDK ops', () => {
    const offenders = sourceFiles().flatMap((path) =>
      offensesIn(path, stripBlockComments(readFileSync(path, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });

  test('the banned-verb pattern still matches every write op the SDK exports today', () => {
    // Sentinel, not exhaustive: if this ever stops matching a real SDK export, THIS is what
    // should fail, not a silent gap in the scan above. See docs/unifi.md for the excluded
    // families (device/client/hotspot) and firewall-policy ordering's own future PR.
    const knownWriteOps = [
      'createNetwork',
      'updateNetwork',
      'deleteNetwork',
      'createFirewallZone',
      'updateFirewallZone',
      'deleteFirewallZone',
      'createFirewallPolicy',
      'patchFirewallPolicy',
      'updateFirewallPolicyOrdering',
      'adoptDevice',
      'removeDevice',
      'executeAdoptedDeviceAction',
    ];
    for (const op of knownWriteOps) expect(WRITE_OP_NAME.test(op)).toBe(true);
  });

  test("the scan ignores Alchemy's own adopt() and the refusal vocabulary, unscoped", () => {
    // A realistic slice of `network.ts`/`policy.ts`'s actual shape: Alchemy's `adopt()` (a
    // different import specifier entirely, not `@distilled.cloud/unifi-network/*`) and the
    // string literals `refuseWrite` sends — neither is a reference TO an SDK op.
    const safe = `
      import { adopt } from 'alchemy/AdoptPolicy';
      import * as networks from '@distilled.cloud/unifi-network/networks';
      export type UnifiWriteAction = 'create' | 'update' | 'delete';
      export const network = (id: string, props: NetworkProps) =>
        UnifiNetwork(id, props).pipe(adopt(true));
      export const read = (props: NetworkProps) => networks.getNetworkDetails(props);
    `;
    expect(offensesIn('safe.ts', stripBlockComments(safe))).toEqual([]);
  });

  test('the scan DOES flag a real SDK write reference, by namespace or by named import', () => {
    const byNamespace = `
      import * as networks from '@distilled.cloud/unifi-network/networks';
      export const bad = (props: unknown) => networks.deleteNetwork(props);
    `;
    expect(offensesIn('bad-namespace.ts', stripBlockComments(byNamespace))).toEqual([
      "bad-namespace.ts: references 'networks.deleteNetwork'",
    ]);

    const byNamedImport = `
      import { updateFirewallZone } from '@distilled.cloud/unifi-network/firewall';
    `;
    expect(offensesIn('bad-named-import.ts', stripBlockComments(byNamedImport))).toEqual([
      "bad-named-import.ts: named-imports SDK op 'updateFirewallZone'",
    ]);
  });
});
