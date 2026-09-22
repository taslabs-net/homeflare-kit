/**
 * One endpoint, turned into the block of declarations that lands in a generated file.
 *
 * ⛔ THE METHOD ORDER IS `GET, POST, PUT, DELETE`, NOT THE SCHEMA'S OWN. Both `apidoc.js` files
 *   hold each node's methods in alphabetical order (`DELETE` first), and the committed files are
 *   in lifecycle order. Reproducing the lifecycle order is what keeps this generator's output
 *   comparable with what is already on disk — sorting differently would have made all 8,196
 *   committed lines move and hidden every real change inside the shuffle.
 */
import type { TsField } from './tsexpr.ts';
import { declaration } from './tsexpr.ts';
import { type VendorNode, paramType, returnType } from './tsmap.ts';
import { segmentsOf, typeName } from './tsname.ts';

interface RawNode {
  readonly path?: string;
  readonly info?: Readonly<Record<string, RawInfo>>;
  readonly children?: readonly RawNode[];
}

interface RawInfo {
  readonly parameters?: { readonly properties?: Readonly<Record<string, VendorNode>> | null };
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
  const properties = endpoint.info.parameters?.properties;
  const inPath = pathParams(endpoint.path);
  const names =
    properties === null || properties === undefined
      ? []
      : Object.keys(properties)
          .filter((name) => !inPath.has(name))
          .sort();
  const parts: string[] = [];
  const declared: string[] = [];
  if (names.length > 0 && properties !== null && properties !== undefined) {
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
