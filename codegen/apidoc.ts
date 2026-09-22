/**
 * Reading Proxmox's own `apidoc.js` — the half of the vendor schema the old generator threw away.
 *
 * ⛔ THE GENERATOR THIS SITS BESIDE DID NOT EXIST. `generated/{pve,pbs}.ts` have said
 *   `Run: bun codegen/generate.ts` since they were committed and `git log --all -- 'codegen/*'` is
 *   empty: nobody could reproduce or correct the mapping, which is why nobody noticed it keeps
 *   `type`, `enum` and `optional` and drops every bound. This file is the first half of the
 *   replacement and deliberately does NOT re-emit the types — regenerating 7.4k lines of shapes
 *   from a schema read on a different day is a diff nobody can review beside a behaviour change.
 *
 * ⚠️ THE TWO FILES ARE NOT THE SAME DIALECT AND A PARSER THAT PRETENDS THEY ARE LOSES DATA:
 *   - PVE opens `const apiSchema = [`, PBS `var apiSchema = [`.
 *   - PVE terminates with a line that is exactly `]`, PBS with exactly `];`, and BOTH files carry
 *     viewer JavaScript after it. ⛔ Slicing on a TRIMMED `]` cuts at the first nested array
 *     instead — PVE indents three spaces, so `      ]` trims to `]` thousands of lines early.
 *   - PVE `format` is a NAME (`pve-calendar-event`); PBS `format` is a whole sub-schema object for
 *     the inside of a property string. Treating them alike prints `[object Object]`.
 */
export interface VendorParam {
  readonly type?: string;
  readonly optional?: number | boolean;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
  readonly enum?: readonly string[];
  readonly format?: string | Record<string, unknown>;
  readonly default?: unknown;
  readonly description?: string;
  /**
   * ⛔ AN ARRAY PARAMETER CARRIES ITS RULES HERE, NOT ON ITSELF. Both products spell an array as
   *   `{type: 'array', items: {maxLength: 32, pattern: …}}`, so a generator that reads only the
   *   parameter emits a row with no rule at all — see param-rules.ts.
   */
  readonly items?: VendorParam;
}

export interface VendorEndpoint {
  readonly method: 'POST' | 'PUT' | 'DELETE' | 'GET';
  readonly path: string;
  readonly params: Readonly<Record<string, VendorParam>>;
}

interface RawNode {
  readonly path?: string;
  readonly info?: Record<string, { parameters?: { properties?: Record<string, VendorParam> } }>;
  readonly children?: readonly RawNode[];
}

/**
 * ⛔ THE TERMINATOR TEST IS `line === ']'`, NEVER `line.trim() === ']'`. See the ⚠️ above; the
 *   trimmed form parses a fraction of PVE and reports a plausible, wrong census.
 */
export const parseApidoc = (text: string): readonly RawNode[] => {
  const decl = text.startsWith('var apiSchema') ? 'var apiSchema = [' : 'const apiSchema = [';
  const start = text.indexOf(decl);
  if (start < 0) throw new Error(`apidoc: no '${decl}' — is this an api-viewer apidoc.js?`);
  const lines = text.slice(start + decl.length).split('\n');
  const end = lines.findIndex((line) => line === ']' || line === '];');
  if (end < 0) throw new Error('apidoc: no line that is exactly `]` or `];` — file truncated?');
  return JSON.parse(`[${lines.slice(0, end).join('\n')}]`) as readonly RawNode[];
};

/** Every endpoint in the tree, flattened. `path` is the vendor's own template, `{id}` and all. */
export const endpointsOf = (roots: readonly RawNode[]): readonly VendorEndpoint[] => {
  const out: VendorEndpoint[] = [];
  const walk = (node: RawNode): void => {
    for (const [method, info] of Object.entries(node.info ?? {})) {
      if (node.path === undefined) continue;
      out.push({
        method: method as VendorEndpoint['method'],
        params: info?.parameters?.properties ?? {},
        path: node.path,
      });
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
};

/** `POST /config/verify` — how a Resource names the endpoint it writes. */
export const keyOf = (endpoint: VendorEndpoint): string => `${endpoint.method} ${endpoint.path}`;
