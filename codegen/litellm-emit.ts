/**
 * Turning LiteLLM's own OpenAPI schemas into TypeScript interfaces, faithfully.
 *
 * ⛔ NOTHING HERE INVENTS A SHAPE. A schema this file cannot resolve without guessing throws,
 *   naming the schema and the property — the same "no row rather than a guess" rule
 *   `codegen/openapi.ts` follows for the PVE/PBS constraint tables. Since this generator emits
 *   TYPES (every field matters to the compiler), "no row" here means the whole run stops rather
 *   than silently narrowing a resource's props.
 *
 * ★ OPENAPI 3.1's `anyOf: [T, {type: "null"}]` IS THE ONE SHAPE THIS FILE SPECIAL-CASES, because
 *   it is how the whole LiteLLM document spells "nullable" (3.1 dropped the 3.0 `nullable: true`
 *   keyword). `guardrails`, `methods`, `timeout` and `id` on `PassThroughGenericEndpoint` all use
 *   it, one of them (`guardrails`) two levels deep. Any OTHER `anyOf`/`oneOf` shape — a real union
 *   of more than one non-null branch — throws rather than being flattened or guessed at.
 */

export interface JsonSchema {
  readonly $ref?: string;
  readonly type?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly anyOf?: readonly JsonSchema[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly default?: unknown;
  readonly description?: string;
}

export interface OpenApiDoc {
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly components: { readonly schemas: Readonly<Record<string, JsonSchema>> };
}

const refName = (ref: string): string => {
  const name = ref.replace('#/components/schemas/', '');
  if (name === ref) throw new Error(`litellm-emit: $ref '${ref}' is not a components/schemas ref`);
  return name;
};

/**
 * The TS type text for one schema, and every named schema it references (added to `wanted` so the
 * caller emits an interface for it too). Named schemas are referenced BY NAME, never inlined and
 * never resolved here — `litellm.ts`'s queue drains `wanted` against `doc.components.schemas`, so
 * this function needs no document, only the schema fragment in front of it.
 */
const typeOf = (schema: JsonSchema, wanted: Set<string>, where: string): string => {
  if (schema.$ref !== undefined) {
    const name = refName(schema.$ref);
    wanted.add(name);
    return name;
  }
  if (schema.anyOf !== undefined) {
    const branches = schema.anyOf;
    const nonNull = branches.filter((branch) => branch.type !== 'null');
    const hasNull = branches.length !== nonNull.length;
    if (nonNull.length !== 1) {
      throw new Error(
        `litellm-emit: ${where}: anyOf has ${String(nonNull.length)} non-null branches, not the ` +
          "single 'T | null' shape this generator handles — emitting no row rather than guessing.",
      );
    }
    const inner = typeOf(nonNull[0] as JsonSchema, wanted, where);
    return hasNull ? `${inner} | null` : inner;
  }
  if (schema.type === 'array') {
    if (schema.items === undefined) throw new Error(`litellm-emit: ${where}: array with no items`);
    return `readonly ${typeOf(schema.items, wanted, where)}[]`;
  }
  if (schema.type === 'object') {
    const ap = schema.additionalProperties;
    if (ap === undefined || ap === true) return 'Record<string, unknown>';
    if (ap === false) throw new Error(`litellm-emit: ${where}: closed object with no properties`);
    return `Record<string, ${typeOf(ap, wanted, `${where} value`)}>`;
  }
  if (schema.type === 'string') return 'string';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  throw new Error(`litellm-emit: ${where}: unhandled schema ${JSON.stringify(schema)}`);
};

const jsdoc = (indent: string, schema: JsonSchema): string => {
  const lines: string[] = [];
  if (schema.description !== undefined) lines.push(...schema.description.split('\n'));
  if (schema.default !== undefined) lines.push(`@default ${JSON.stringify(schema.default)}`);
  if (lines.length === 0) return '';
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`).join('\n')}\n${indent} */\n`;
};

/** One `export interface Name { ... }`, fields in the vendor's own property order. */
export const renderInterface = (name: string, schema: JsonSchema, wanted: Set<string>): string => {
  if (schema.type !== 'object' || schema.properties === undefined) {
    throw new Error(`litellm-emit: ${name}: not an object schema with properties`);
  }
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties).map(([field, raw]) => {
    const optional = !required.has(field);
    const ts = typeOf(raw, wanted, `${name}.${field}`);
    return `${jsdoc('  ', raw)}  readonly ${field}${optional ? '?' : ''}: ${ts};`;
  });
  return `export interface ${name} {\n${fields.join('\n')}\n}`;
};

/** `doc.paths[path][method]`, or throws — the vendor-lacks-this-key failure `--check` reports. */
export const requireOperation = (
  doc: OpenApiDoc,
  method: string,
  path: string,
): Readonly<Record<string, unknown>> => {
  const ops = doc.paths[path];
  const op = ops?.[method.toLowerCase()];
  if (op === undefined) {
    throw new Error(
      `litellm-emit: the schema has no ${method} ${path} — litellm 1.100.0's OpenAPI document ` +
        'does not have this operation. Fix the endpoint key in the consumer, or the schema is stale.',
    );
  }
  return op as Readonly<Record<string, unknown>>;
};
