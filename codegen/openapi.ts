/**
 * Reading an OpenAPI 3 document into the same `VendorEndpoint` shape `apidoc.ts` produces.
 *
 * ★ ONE INTERCHANGE TYPE, TWO VENDOR DIALECTS. Proxmox publishes an `apiSchema` JavaScript array;
 *   NetBox publishes OpenAPI 3.0.3. Normalising both to `VendorEndpoint` is what lets `emit.ts`,
 *   the digest and the constraint reader stay one implementation instead of two that drift.
 *
 * ⛔ NOTHING HERE INVENTS A RULE. A property with no bound in the document produces no bound, and
 *   a shape this file cannot resolve faithfully produces NO ROW AT ALL rather than a guess. The
 *   whole point of generating is that a reader can tell what the vendor actually said.
 */
import type { VendorEndpoint, VendorParam } from './apidoc.ts';

export interface JsonSchema {
  readonly $ref?: string;
  readonly type?: string;
  readonly enum?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly oneOf?: readonly JsonSchema[];
  readonly anyOf?: readonly JsonSchema[];
  readonly allOf?: readonly JsonSchema[];
  readonly nullable?: boolean;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
  readonly format?: string;
  readonly default?: unknown;
  /** ⚠️ `openapi-types.ts` reads both — a request type drops a `readOnly` field, never emits a `writeOnly` one. */
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
  readonly description?: string;
}

interface Operation {
  readonly requestBody?: {
    readonly content?: Readonly<Record<string, { readonly schema?: JsonSchema }>>;
  };
}

export interface OpenApiDoc {
  readonly openapi?: string;
  readonly info?: { readonly title?: string; readonly version?: string };
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
  readonly components?: { readonly schemas?: Readonly<Record<string, JsonSchema>> };
}

const WRITE_METHODS = ['post', 'put', 'patch', 'delete'] as const;

export const parseOpenApi = (text: string): OpenApiDoc => {
  const doc = JSON.parse(text) as OpenApiDoc;
  if (doc.openapi === undefined || doc.paths === undefined) {
    throw new Error('openapi: no `openapi` version or no `paths` — is this an OpenAPI document?');
  }
  return doc;
};

/**
 * ⚠️ ONLY `#/components/schemas/...` IS FOLLOWED. drf-spectacular emits nothing else, and a
 *   silently unresolved `$ref` would read as "this object has no properties" — a table that
 *   enforces nothing while looking generated.
 */
const deref = (doc: OpenApiDoc, schema: JsonSchema): JsonSchema => {
  const ref = schema.$ref;
  if (ref === undefined) return schema;
  const name = ref.replace('#/components/schemas/', '');
  const target = doc.components?.schemas?.[name];
  if (target === undefined) throw new Error(`openapi: unresolved $ref ${ref}`);
  return target;
};

/**
 * The object schema a write operation's JSON body takes.
 *
 * ⛔ A NETBOX POST BODY IS `oneOf: [Writable<X>Request, array of Writable<X>Request]` — the bulk
 *   form. Taking `oneOf[0]` blindly happens to work here and would break the day the vendor
 *   reorders the branches, so the OBJECT branch is selected by shape: the one that is not an
 *   array. Picking the array branch yields a schema with no `properties` at all, which produces
 *   an empty table that looks perfectly generated and enforces nothing.
 */
const bodySchema = (doc: OpenApiDoc, op: Operation): JsonSchema | undefined => {
  const raw = op.requestBody?.content?.['application/json']?.schema;
  if (raw === undefined) return undefined;
  const resolved = deref(doc, raw);
  if (resolved.oneOf === undefined) return resolved;
  const objects = resolved.oneOf
    .map((branch) => deref(doc, branch))
    .filter((branch) => branch.type !== 'array');
  return objects.length === 1 ? objects[0] : undefined;
};

/**
 * ⚠️ A NULLABLE FOREIGN KEY IS `oneOf: [{integer}, {allOf:[Brief<X>Request], nullable}]`, AND
 *   FLATTENING IT IS THE TRAP. The `Brief…` branch carries the RELATED object's rules — a
 *   tenant's own `name` maxLength, a VLAN's own `vid` bounds — and none of them govern the field
 *   in front of you, which holds an integer id or a whole nested object. So a union of branches
 *   is reduced to its scalar type and NOTHING ELSE: no bound, no pattern, no enum.
 */
const unionType = (doc: OpenApiDoc, branches: readonly JsonSchema[]): string | undefined => {
  const types = new Set(
    branches
      .map((branch) => deref(doc, branch))
      .map((branch) => (branch.type === undefined ? 'object' : branch.type))
      .filter((type) => type !== 'null'),
  );
  const joined = [...types].sort().join('|');
  return joined === '' ? undefined : joined;
};

/**
 * ⚠️ BUILT AS A WIDER RECORD AND PRUNED, NOT AS A `VendorParam`. `exactOptionalPropertyTypes` is
 *   on, so writing `maxLength: undefined` is a type error rather than an absent key — the same
 *   reason `emit.ts` prunes, and the same fix.
 */
const prune = (value: Record<string, unknown>): VendorParam =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as VendorParam;

/**
 * One property of a writable request body, as a `VendorParam`.
 *
 * ⚠️ `optional` IS INVERTED ON PURPOSE. `apidoc.ts` speaks Proxmox's `optional: 1`; OpenAPI
 *   speaks a `required` array on the parent. Normalising here keeps `emit.ts` from needing to
 *   know which vendor it is reading.
 */
const toParam = (doc: OpenApiDoc, raw: JsonSchema, required: boolean): VendorParam => {
  const optional = required ? 0 : 1;
  const union = raw.oneOf ?? raw.anyOf;
  if (union !== undefined) return prune({ optional, type: unionType(doc, union) });
  // ⚠️ A single-branch `allOf` is drf-spectacular's way of attaching `nullable`/`description` to
  //   a `$ref`. Following it is safe; a multi-branch `allOf` is a composition this file does not
  //   claim to merge, so it degrades to the bare type.
  const first = raw.allOf?.[0];
  const schema = raw.allOf?.length === 1 && first !== undefined ? deref(doc, first) : raw;
  return prune({
    default: schema.default,
    enum: schema.enum,
    format: schema.format,
    maxLength: schema.maxLength,
    maximum: schema.maximum,
    minLength: schema.minLength,
    minimum: schema.minimum,
    optional,
    pattern: schema.pattern,
    type: schema.type,
  });
};

/**
 * Every write endpoint in the document, with its JSON body's properties as parameters.
 *
 * ⛔ DELETE IS INCLUDED IN THE CENSUS AND CARRIES NO PARAMETERS. It is a write endpoint for the
 *   coverage report's purposes; it just has no body to constrain.
 */
export const openApiEndpoints = (doc: OpenApiDoc): readonly VendorEndpoint[] => {
  const out: VendorEndpoint[] = [];
  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const method of WRITE_METHODS) {
      const op = ops[method];
      if (op === undefined) continue;
      const body = bodySchema(doc, op);
      const required = new Set(body?.required ?? []);
      const params: Record<string, VendorParam> = {};
      for (const [name, raw] of Object.entries(body?.properties ?? {})) {
        params[name] = toParam(doc, raw, required.has(name));
      }
      out.push({ method: method.toUpperCase() as VendorEndpoint['method'], params, path });
    }
  }
  return out;
};

/** `POST /api/ipam/prefixes/` — how a Resource names the endpoint it writes. */
export const openApiKeyOf = (endpoint: VendorEndpoint): string =>
  `${endpoint.method} ${endpoint.path}`;
