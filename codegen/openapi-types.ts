/**
 * OpenAPI 3 component schema -> TypeScript interface, for exactly the endpoints a family names.
 *
 * ★ A TYPE EMITTER OVER `openapi.ts`'S `JsonSchema`, NOT A SECOND READER OF THE DOCUMENT.
 *   `openapi.ts` flattens a request body into `VendorParam` rows for the CONSTRAINT tables —
 *   lossy on purpose (a union collapses to `'integer|object'`). A TypeScript interface needs the
 *   shape faithfully, so this file walks the same `JsonSchema` a second way: enums as literal
 *   unions, nullable as `| null`, nested objects inlined — and stops at the first construct it
 *   does not recognise rather than emitting `unknown` silently for something it could have typed.
 *
 * ⛔ NOTHING HERE INVENTS A RULE OR A SHAPE. A property this file cannot resolve faithfully is a
 *   generator error, not a guess — the same posture `openapi.ts` takes for constraints.
 * ⛔ READ-ONLY FIELDS NEVER APPEAR IN A REQUEST TYPE, and a write-only field (Paperless's
 *   `set_permissions`) never appears in either — this slice does not model permission writes.
 * ⛔ EVERY EMITTED MODULE IS CHECKED AGAINST THE HOUSE 250-LINE CAP AND THROWS OVER IT. The
 *   caller supplies one `FamilyKey` per vendor "area" (Paperless: tags, document_types,
 *   storage_paths, custom_fields), so a family that grows past the cap is a decision the caller
 *   makes by splitting the family, not a generator that silently writes an oversized file.
 */
import type { JsonSchema, OpenApiDoc } from './openapi.ts';

export const CAP = 250;

/** One write endpoint a family names, and the TypeScript name its types are built from. */
export interface FamilyKey {
  /** `tags` — the vendor's own path segment; also the emitted file's base name. */
  readonly area: string;
  /** `Tag` — component `Tag`/`TagRequest`, emitted type `Paperless{tsName}`/`…Request`. */
  readonly tsName: string;
  /** `paperless:POST /api/tags/` — resolved against `doc.paths`; a miss stops the generator. */
  readonly createKey: string;
}

export interface ManifestHeader {
  readonly id: string;
  readonly product: string;
  readonly version: string;
  readonly sha256: string;
}

const deref = (doc: OpenApiDoc, schema: JsonSchema): JsonSchema => {
  if (schema.$ref === undefined) return schema;
  const name = schema.$ref.replace('#/components/schemas/', '');
  const target = doc.components?.schemas?.[name];
  if (target === undefined) throw new Error(`openapi-types: unresolved $ref ${schema.$ref}`);
  return target;
};

/** ⚠️ A single-branch `allOf` is drf-spectacular's way to attach bounds to a `$ref` (matching_algorithm). */
const resolve = (doc: OpenApiDoc, schema: JsonSchema): JsonSchema => {
  const first = schema.allOf?.[0];
  return schema.allOf?.length === 1 && first !== undefined ? deref(doc, first) : deref(doc, schema);
};

const enumLiteral = (values: readonly unknown[]): string =>
  values.map((v) => (typeof v === 'string' ? JSON.stringify(v) : String(v))).join(' | ');

/** One property line: `name?: type;` or, for a response, `readonly name?: type;`. */
const field = (
  doc: OpenApiDoc,
  name: string,
  raw: JsonSchema,
  required: boolean,
  ro: boolean,
): string => `  ${ro ? 'readonly ' : ''}${name}${required ? '' : '?'}: ${tsType(doc, raw)};`;

/**
 * ⛔ THE ONLY UNRESOLVED SHAPE IS "NO TYPE AND NO ENUM" — Paperless's own `extra_data` (arbitrary
 *   JSON attached to a custom field, no `type` key in the schema at all). That is `unknown`, not a
 *   guess: the vendor states nothing to be more specific about.
 */
const tsType = (doc: OpenApiDoc, schema: JsonSchema): string => {
  const resolved = resolve(doc, schema);
  const base = baseType(doc, resolved);
  return resolved.nullable === true ? `${base} | null` : base;
};

const baseType = (doc: OpenApiDoc, resolved: JsonSchema): string => {
  if (resolved.enum !== undefined) return enumLiteral(resolved.enum);
  if (resolved.type === 'object' && resolved.properties !== undefined) {
    const required = new Set(resolved.required ?? []);
    const props = Object.entries(resolved.properties).map(
      ([name, raw]) => `${name}${required.has(name) ? '' : '?'}: ${tsType(doc, raw)}`,
    );
    return `{ ${props.join('; ')} }`;
  }
  if (resolved.type === 'array')
    return resolved.items === undefined ? 'unknown[]' : `${tsType(doc, resolved.items)}[]`;
  if (resolved.type === 'integer' || resolved.type === 'number') return 'number';
  if (resolved.type === 'string') return 'string';
  if (resolved.type === 'boolean') return 'boolean';
  return 'unknown';
};

/** Every field of a component, as `[name, schema, required]`, write-only ones dropped. */
const writableFields = (
  schema: JsonSchema,
): readonly (readonly [string, JsonSchema, boolean])[] => {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {})
    .filter(([, raw]) => raw.writeOnly !== true)
    .map(([name, raw]) => [name, raw, required.has(name)] as const);
};

const componentOf = (doc: OpenApiDoc, name: string): JsonSchema => {
  const schema = doc.components?.schemas?.[name];
  if (schema === undefined) throw new Error(`openapi-types: no component schema '${name}'`);
  return schema;
};

/**
 * A request interface: every writable field, read-only ones dropped (⛔ a request schema
 * carrying one would be a vendor oddity this generator refuses to guess about).
 */
export const renderRequest = (doc: OpenApiDoc, name: string, componentName: string): string => {
  const lines = writableFields(componentOf(doc, componentName))
    .filter(([, raw]) => raw.readOnly !== true)
    .map(([propName, raw, required]) => field(doc, propName, raw, required, false));
  return `export interface ${name} {\n${lines.join('\n')}\n}\n`;
};

/** A response interface: every writable-or-readable field, read-only ones marked `readonly`. */
export const renderResponse = (doc: OpenApiDoc, name: string, componentName: string): string => {
  const lines = writableFields(componentOf(doc, componentName)).map(([propName, raw, required]) =>
    field(doc, propName, raw, required, raw.readOnly === true),
  );
  return `export interface ${name} {\n${lines.join('\n')}\n}\n`;
};

const refName = (schema: JsonSchema | undefined, what: string): string => {
  if (schema?.$ref === undefined) {
    throw new Error(
      `openapi-types: ${what} is not a direct $ref — this generator does not follow a union here`,
    );
  }
  return schema.$ref.replace('#/components/schemas/', '');
};

const header = (manifest: ManifestHeader, family: FamilyKey, coverage: string): string =>
  `/**
 * Generated ${manifest.product} request/response types for \`/api/${family.area}/\` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/paperless.ts
 * Manifest entry: \`${manifest.id}\` — ${manifest.product} ${manifest.version}, sha256 ${manifest.sha256.slice(0, 16)}
 *
 * ${coverage}
 *
 * ⛔ \`set_permissions\` (writeOnly) is not modelled in this slice — no property here writes it.
 */
`;

/** One family's Request and Response interfaces, as one file — throws over the 250-line cap. */
export const emitFamilyModule = (
  doc: OpenApiDoc,
  manifest: ManifestHeader,
  family: FamilyKey,
  coverage: string,
): { readonly file: string; readonly text: string } => {
  const [method, path] = family.createKey.slice(family.createKey.indexOf(':') + 1).split(' ');
  const op = doc.paths[path ?? '']?.[(method ?? '').toLowerCase()];
  if (op === undefined) {
    throw new Error(`openapi-types: ${family.createKey} has no operation in the vendor document`);
  }
  const request = refName(
    (op as { requestBody?: { content?: Record<string, { schema?: JsonSchema }> } }).requestBody
      ?.content?.['application/json']?.schema,
    `${family.createKey} requestBody`,
  );
  const response = refName(
    (op as { responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }> })
      .responses?.['201']?.content?.['application/json']?.schema,
    `${family.createKey} 201 response`,
  );
  const requestName = `Paperless${family.tsName}Request`;
  const responseName = `Paperless${family.tsName}`;
  const text = `${
    header(manifest, family, coverage) + renderRequest(doc, requestName, request)
  }\n${renderResponse(doc, responseName, response)}`;
  const lines = text.split('\n').length;
  if (lines > CAP) {
    throw new Error(
      `generated/types/${family.area}.ts would be ${lines} lines, over the house cap of ${CAP}.`,
    );
  }
  return { file: `${family.area.replaceAll('_', '-')}.ts`, text };
};
