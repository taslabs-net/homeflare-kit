/**
 * One endpoint, turned into the block of declarations that lands in a generated file.
 *
 * ⛔ THE METHOD ORDER IS `GET, POST, PUT, DELETE`, NOT THE SCHEMA'S OWN. Both `apidoc.js` files
 *   hold each node's methods in alphabetical order (`DELETE` first), and the committed files are
 *   in lifecycle order. Reproducing the lifecycle order is what keeps this generator's output
 *   comparable with what is already on disk — sorting differently would have made all 8,196
 *   committed lines move and hidden every real change inside the shuffle.
 */
import { resolveParameters } from './parameters.ts';
import type { TsField } from './tsexpr.ts';
import { declaration } from './tsexpr.ts';
import { type VendorNode, paramType, returnType } from './tsmap.ts';
import { segmentsOf, typeName } from './tsname.ts';

interface RawNode {
  readonly path?: string;
  readonly info?: Readonly<Record<string, RawInfo>>;
  readonly children?: readonly RawNode[];
}

/**
 * ⛔ `parameters` IS `unknown` BECAUSE IT IS NOT ALWAYS A `properties` MAP. PVE spells
 *   `POST /cluster/ha/rules` as `allOf: [{properties}, {oneOf: […]}]` — a discriminated union on
 *   `instance-type` — and a reader that asks for `parameters.properties` gets `undefined` and
 *   emits an EMPTY type, which is indistinguishable from an endpoint that takes nothing.
 *   `codegen/parameters.ts` resolves both combinators and carries the measurement; two PVE
 *   endpoints need it, and they are worth twelve parameters that were otherwise silently absent.
 */
interface RawInfo {
  readonly parameters?: unknown;
  readonly returns?: VendorNode;
}

export interface Endpoint {
  readonly method: string;
  readonly path: string;
  readonly info: RawInfo;
}

const LIFECYCLE = ['GET', 'POST', 'PUT', 'DELETE'];

const rank = (method: string): number => {
  const index = LIFECYCLE.indexOf(method);
  return index < 0 ? LIFECYCLE.length : index;
};

/** Every endpoint in the tree, parents before children, methods in lifecycle order. */
export const endpoints = (roots: readonly RawNode[]): readonly Endpoint[] => {
  const out: Endpoint[] = [];
  const walk = (node: RawNode): void => {
    const path = node.path;
    if (path !== undefined) {
      for (const [method, info] of Object.entries(node.info ?? {}).sort(
        ([left], [right]) => rank(left) - rank(right),
      )) {
        out.push({ info, method, path });
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
};

/** `{node}` in `/nodes/{node}/network` — built into the URL, never sent as a form key. */
const pathParams = (path: string): ReadonlySet<string> =>
  new Set([...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] as string));

export interface Block {
  readonly key: string;
  readonly segments: readonly string[];
  readonly names: readonly string[];
  readonly text: string;
  readonly lines: number;
}

/**
 * The declarations for one endpoint: its request parameters (when it has any that are not path
 * segments) and its response payload.
 *
 * ⛔ A PATH PARAMETER IS NOT IN THE FORM. `spec.path(props)` builds `pools/lab` itself, so `{id}`
 *   never appears as a form key — and a `Params` type that demanded it would make every create
 *   look as though it were missing a required field that was never missing.
 * ⚠️ `Params` IS OMITTED ENTIRELY WHEN NOTHING IS LEFT, rather than emitted as `{}`. An empty
 *   object type accepts anything in TypeScript, so `{}` would be a weaker claim than silence.
 */
export const blockFor = (endpoint: Endpoint): Block => {
  const key = `${endpoint.method} ${endpoint.path}`;
  const resolved = resolveParameters(endpoint.info.parameters);
  const properties = resolved.params as Readonly<Record<string, VendorNode>>;
  const inPath = pathParams(endpoint.path);
  const names = Object.keys(properties)
    .filter((name) => !inPath.has(name))
    .sort();
  const parts: string[] = [];
  const declared: string[] = [];
  // ⛔ AN UNREADABLE PARAMETER SCHEMA GETS NO TYPE AND A REASON, NOT AN EMPTY OBJECT. `{}` would
  //   read as "this endpoint takes nothing", which is the defect `parameters.ts` exists to stop.
  //   Neither product needs this on the versions in the manifest; it is here for the one that does.
  if (resolved.unresolved !== undefined) {
    parts.push(`/** ${key} — parameters NOT READ: ${resolved.unresolved}. No Params type. */`);
  } else if (names.length > 0) {
    const fields: TsField[] = names.map((name) => {
      const property = properties[name] as VendorNode;
      return {
        name,
        optional: property.optional === 1 || property.optional === true,
        type: paramType(property),
      };
    });
    const name = typeName(endpoint.method, endpoint.path, 'Params');
    declared.push(name);
    parts.push(`/** ${key} — form/query parameters (path segments omitted). */`);
    parts.push(declaration(name, { fields, kind: 'object', open: false }));
  }
  const returnName = typeName(endpoint.method, endpoint.path, 'Return');
  declared.push(returnName);
  parts.push(`/** ${key} — \`data\` payload after client unwrap. */`);
  parts.push(declaration(returnName, returnType(endpoint.info.returns)));
  const text = `${parts.join('\n')}\n`;
  return {
    key,
    lines: text.split('\n').length - 1,
    names: declared,
    segments: segmentsOf(endpoint.path),
    text,
  };
};
