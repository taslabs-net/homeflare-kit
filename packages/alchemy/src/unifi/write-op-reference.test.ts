/**
 * B0a / T12 static guard: no file under `src/unifi` (recursively) may reference an SDK write
 * operation — a check that travels with the DIRECTORY, not with today's two-family knowledge of
 * what those operations are named. `resource.ts`'s engine and `policy.ts`'s refusal never call one
 * today; nothing in the TYPE SYSTEM stops a future family file from importing, say,
 * `unifi_devices.adoptDevice` and calling it directly, bypassing `unifiOperations` altogether.
 * `GetOnlyHttpClient` (`resource.ts`) is the runtime backstop if one ever did; this is the static
 * one, so the mistake is caught at test time instead of by a wire-level defect.
 *
 * ⚠️ REWRITTEN (2026-09-26, red team, IMPORTANT-2). The previous version parsed import statements
 *   structurally (namespace alias + `.op`, or a named import's LOCAL name) and missed: the SDK's
 *   own documented bare-specifier root import, an `as`-aliased named import (checked the wrong
 *   side), destructuring, bracket access, re-export, and dynamic `import()` — five different
 *   syntax shapes a write op reference could hide behind, all invisible to that parser. Trying to
 *   special-case every one of those forms is an unbounded list; the fix here is a different
 *   design, not a patch: harvest the SDK's REAL write-op export names straight from its own service
 *   modules (below), then fail any file that mentions the SDK's package specifier anywhere AND
 *   contains one of those exact names as a token anywhere in its code — an identifier, a bracket
 *   key, a destructured binding, a re-export, or a dynamic-import property access all show up as
 *   the same literal text, so one scan catches all of them without parsing which syntax form it is.
 * ⚠️ COMMENTS ARE STRIPPED WITH A SINGLE LEFT-TO-RIGHT SCAN, NOT TWO INDEPENDENT REGEXES — see
 *   `scan-source.ts`'s header for why (LOW-4's "glob-like string" bug and the apostrophe-in-prose
 *   trap this replaces). `stripComments`/`walk` are SHARED with `wifi-broadcast-details-call.test.ts`
 *   (red team, IMPORTANT-2, 2026-09-26) rather than duplicated a second time.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments, walk } from './scan-source.ts';

const SELF = fileURLToPath(import.meta.url);
const DIR = dirname(SELF);
const SDK_MARKER = '@distilled.cloud/unifi-network';
const SDK_SERVICES_DIR = resolve(DIR, '../../../distilled-unifi-network/src/services');
const BANNED_VERBS = ['create', 'update', 'delete', 'patch', 'execute', 'remove', 'adopt'];
// A bare verb or a verb-led camelCase op name (`deleteFirewallZone`, `adoptDevice`) — never a
// longer English word that merely starts the same way (`removes`, `updated`, `deletion`).
const WRITE_OP_NAME = new RegExp(`^(?:${BANNED_VERBS.join('|')})(?:[A-Z][A-Za-z0-9]*)?$`);

/** Every real write-op export name the SDK has TODAY, read from its own service modules — not a
 *  hand-maintained list, so a renamed operation or a new service file is caught here for free
 *  instead of silently falling outside a list this test forgot to update. */
const sdkWriteOpNames = (): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const file of walk(SDK_SERVICES_DIR)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/export (?:const|function) ([A-Za-z_$][\w$]*)/g)) {
      if (WRITE_OP_NAME.test(m[1] ?? '')) names.add(m[1] as string);
    }
  }
  return names;
};

const REAL_WRITE_OP_NAMES = sdkWriteOpNames();

/** Recursive by construction (IMPORTANT-2): a future `src/unifi/<subdir>/*.ts` is walked too. */
const sourceFiles = () => walk(DIR).filter((path) => path !== SELF);

/** Every offense in one file: any real SDK write-op name appearing as a token anywhere in its
 *  comment-stripped text, GATED on the file mentioning the SDK's package specifier at all (a file
 *  that never imports it — by any syntax — cannot meaningfully reference one of its exports). */
const offensesIn = (path: string, rawSrc: string): string[] => {
  if (!rawSrc.includes(SDK_MARKER)) return [];
  const codeSrc = stripComments(rawSrc);
  const offenses: string[] = [];
  for (const name of REAL_WRITE_OP_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(codeSrc)) {
      offenses.push(`${path}: references SDK write op '${name}'`);
    }
  }
  return offenses;
};

describe('src/unifi never references an SDK write operation (T12)', () => {
  test('every source file is clean of every write op the SDK exports today', () => {
    const offenders = sourceFiles().flatMap((path) => offensesIn(path, readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('the SDK write-op harvest still finds every op this sentinel names', () => {
    // Sentinel, not exhaustive: if the harvest ever stops finding one of these, the SDK's export
    // shape moved in a way this scan no longer understands -- fail HERE, not by silently scanning
    // for nothing. See docs/unifi.md for the excluded families and firewall-policy ordering's PR.
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
    for (const op of knownWriteOps) expect(REAL_WRITE_OP_NAMES.has(op)).toBe(true);
  });

  test("the scan ignores Alchemy's own adopt() and the refusal vocabulary, unscoped", () => {
    // A realistic slice of network.ts's/policy.ts's actual shape: Alchemy's `adopt()` (a different
    // import specifier entirely) and the bare-word string literals `refuseWrite` sends — neither
    // is a reference TO an SDK op, and neither should ever be flagged.
    const safe = `
      import { adopt } from 'alchemy/AdoptPolicy';
      import * as networks from '${SDK_MARKER}/networks';
      export type UnifiWriteAction = 'create' | 'update' | 'delete';
      export const network = (id: string, props: NetworkProps) =>
        UnifiNetwork(id, props).pipe(adopt(true));
      export const read = (props: NetworkProps) => networks.getNetworkDetails(props);
    `;
    expect(offensesIn('safe.ts', safe)).toEqual([]);
  });

  test('comments quoting a write op name in prose, even with contractions, never trigger it', () => {
    const documented = `
      /**
       * network.ts's own doc: never calls updateNetwork or createNetwork directly. It doesn't,
       * and it's not going to -- an apostrophe here must not make the scanner treat this comment
       * as an unterminated string and swallow the real code below (LOW-4).
       */
      import * as networks from '${SDK_MARKER}/networks';
      // deleteNetwork is refused by policy.ts, never called from here.
      export const read = (props: unknown) => networks.getNetworkDetails(props);
    `;
    expect(offensesIn('documented.ts', documented)).toEqual([]);
  });

  test('a glob-like string does not make the comment stripper swallow the next real line (LOW-4)', () => {
    const globTrap = `
      import * as networks from '${SDK_MARKER}/networks';
      const pattern = "src/*.ts";
      export const bad = () => networks.deleteNetwork({});
    `;
    expect(offensesIn('glob-trap.ts', globTrap)).toEqual([
      "glob-trap.ts: references SDK write op 'deleteNetwork'",
    ]);
  });

  test('the scan flags a real SDK write reference across every syntax form IMPORTANT-2 named', () => {
    const cases: Record<string, string> = {
      'bare-root-import.ts': `
        import * as UnifiNetwork from '${SDK_MARKER}';
        export const bad = () => UnifiNetwork.Services.networks.deleteNetwork({});
      `,
      'aliased-named-import.ts': `
        import { deleteNetwork as readNetwork } from '${SDK_MARKER}/networks';
        export const bad = () => readNetwork({});
      `,
      'destructured.ts': `
        import * as networks from '${SDK_MARKER}/networks';
        const { deleteNetwork } = networks;
        export const bad = () => deleteNetwork({});
      `,
      'bracket-access.ts': `
        import * as networks from '${SDK_MARKER}/networks';
        export const bad = () => (networks as Record<string, unknown>)['deleteNetwork'];
      `,
      're-export.ts': `export { deleteNetwork } from '${SDK_MARKER}/networks';`,
      'dynamic-import.ts': `
        export const bad = async () =>
          (await import('${SDK_MARKER}/networks')).deleteNetwork({});
      `,
    };
    for (const [path, src] of Object.entries(cases)) {
      expect(offensesIn(path, src)).toEqual([`${path}: references SDK write op 'deleteNetwork'`]);
    }
  });

  test('the walk is recursive -- a future src/unifi/<subdir>/*.ts is not silently unscanned', () => {
    const probeDir = join(DIR, '.write-op-reference-recursion-probe');
    const probeFile = join(probeDir, 'nested.ts');
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(
      probeFile,
      `import * as networks from '${SDK_MARKER}/networks';\n` +
        'export const bad = () => networks.deleteNetwork({});\n',
    );
    try {
      expect(sourceFiles()).toContain(probeFile);
      expect(offensesIn(probeFile, readFileSync(probeFile, 'utf8'))).toEqual([
        `${probeFile}: references SDK write op 'deleteNetwork'`,
      ]);
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });
});
