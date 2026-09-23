/**
 * A TypeScript type expression, as a tree, and how it is printed.
 *
 * ★ A TREE RATHER THAN A STRING BECAUSE THE PRINTER HAS TO CHOOSE A LAYOUT. Every `generated`
 *   directory is in oxfmt's ignore list (.oxfmtrc.json), so nothing reflows these files
 *   afterwards — the generator IS the formatter, and it has to make the same inline-or-break
 *   choice a formatter would. Concatenating strings loses the structure that decision needs.
 *
 * ⚠️ THE LAYOUT RULE IS THE ONE THE COMMITTED FILES ALREADY USE, and it is reproduced rather than
 *   chosen: an object prints on one line when the whole declaration fits in `WIDTH`, otherwise one
 *   field per line at two-space indent. Picking a different rule would have made every one of the
 *   8,196 committed lines a diff hunk and hidden the changes that matter.
 */
export type TsExpr =
  /** Printed verbatim: `string`, `number`, `null`, `Record<string, unknown>`. */
  | { readonly kind: 'atom'; readonly text: string }
  /**
   * `'a' | 'b'`, kept apart from `atom` because a long one BREAKS, leading-`|` per line. A union
   * is the only expression whose members can be laid out without braces to hang them on.
   */
  | { readonly kind: 'union'; readonly parts: readonly string[] }
  | { readonly kind: 'array'; readonly item: TsExpr }
  | {
      readonly kind: 'object';
      readonly fields: readonly TsField[];
      /**
       * `& Record<string, unknown>` — the vendor did NOT say `additionalProperties: 0`, so the
       * server may send keys this schema does not list. Claiming a closed object there would let
       * a consumer `satisfies`-check its way into believing a field cannot arrive.
       */
      readonly open: boolean;
    };

export interface TsField {
  readonly name: string;
  readonly optional: boolean;
  readonly type: TsExpr;
}

/** oxfmt's `printWidth` for this repository (.oxfmtrc.json). The generated files match it. */
export const WIDTH = 100;

export const atom = (text: string): TsExpr => ({ kind: 'atom', text });

export const union = (parts: readonly string[]): TsExpr => ({ kind: 'union', parts });

/**
 * Whether an array's element type has to be wrapped in parentheses.
 *
 * ⛔ THE TEST IS STRUCTURAL, NOT TEXTUAL, AND A SUBSTRING TEST GETS IT BACKWARDS. `{ disable?:
 *   boolean | 0 | 1 }` contains a `|` that belongs to a FIELD, safely inside the braces; wrapping
 *   on that would parenthesise every object with a union anywhere in it.
 * ⛔ AN OPEN OBJECT MUST BE WRAPPED. `readonly { id: string } & Record<string, unknown>[]` parses
 *   as an intersection with an ARRAY of records rather than an array of intersections — a
 *   silently different type that still compiles.
 */
const needsParens = (expr: TsExpr): boolean =>
  expr.kind === 'union' || expr.kind === 'array' || (expr.kind === 'object' && expr.open);

/** A property name that is not a plain identifier has to be quoted: `'match-field'`. */
export const propertyKey = (name: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name);

export const quote = (value: string): string =>
  `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

/** The expression on one line, however long that line comes out. */
export const inline = (expr: TsExpr): string => {
  if (expr.kind === 'atom') return expr.text;
  if (expr.kind === 'union') return expr.parts.join(' | ');
  if (expr.kind === 'array') {
    const item = inline(expr.item);
    return `readonly ${needsParens(expr.item) ? `(${item})` : item}[]`;
  }
  const body = expr.fields
    .map((f) => `${propertyKey(f.name)}${f.optional ? '?' : ''}: ${inline(f.type)}`)
    .join('; ');
  const object = body === '' ? '{}' : `{ ${body} }`;
  return expr.open ? `${object} & Record<string, unknown>` : object;
};

/**
 * The expression laid out to fit, given how many columns the first line has already spent.
 *
 * ⚠️ `used` IS THE PREFIX'S WIDTH, NOT AN INDENT. `export type Foo = ` is on the same line as the
 *   opening brace, so the fit test has to include it; `indent` is what the CLOSING brace and the
 *   fields line up against, which is a different number.
 */
export const layout = (expr: TsExpr, used: number, indent: number): string => {
  const flat = inline(expr);
  if (used + flat.length <= WIDTH) return flat;
  if (expr.kind === 'atom') return flat;
  // ⚠️ A BROKEN UNION CARRIES ITS OWN LEADING NEWLINE, so the caller does NOT put one there. It is
  //   the only expression that starts on the line BELOW its `name:`, and callers detect it by the
  //   leading `\n` rather than by re-deciding the fit.
  if (expr.kind === 'union') {
    const pad = ' '.repeat(indent + 2);
    return `\n${expr.parts.map((part) => `${pad}| ${part}`).join('\n')}`;
  }
  if (expr.kind === 'array') {
    // ⚠️ THE PARENTHESES ARE DECIDED BY THE ELEMENT'S SHAPE, NOT BY WHETHER IT BROKE. A
    //   multi-line closed object needs none — `readonly {\n…\n}[]` is already an array of
    //   objects — and adding them anyway differs from every committed declaration for no gain.
    const item = layout(expr.item, used + 'readonly '.length, indent);
    return `readonly ${needsParens(expr.item) ? `(${item})` : item}[]`;
  }
  if (expr.fields.length === 0) return flat;
  const pad = ' '.repeat(indent + 2);
  const rows = expr.fields.map((field) => {
    const head = `${propertyKey(field.name)}${field.optional ? '?' : ''}:`;
    // ⚠️ `+ 2` IS THE SPACE AFTER THE COLON AND THE `;` THAT CLOSES THE FIELD. Forgetting the
    //   semicolon prints a 101-column line and the fit test has lied by exactly one character.
    const body = layout(field.type, indent + 2 + head.length + 2, indent + 2);
    return `${pad}${head}${body.startsWith('\n') ? body : ` ${body}`};`;
  });
  const object = `{\n${rows.join('\n')}\n${' '.repeat(indent)}}`;
  return expr.open ? `${object} & Record<string, unknown>` : object;
};

/** `export type X = …;`, laid out. The one place a declaration's width is decided. */
export const declaration = (name: string, expr: TsExpr): string => {
  const head = `export type ${name} =`;
  const body = layout(expr, head.length + 2, 0);
  return `${head}${body.startsWith('\n') ? body : ` ${body}`};`;
};
