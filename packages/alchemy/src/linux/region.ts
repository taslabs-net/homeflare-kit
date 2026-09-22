/**
 * A MANAGED REGION: a block a resource owns inside a file it does not own.
 *
 * ★ WHY THIS EXISTS. Four files on this estate are owned by something else and still need one
 *   declared block: a packet-filter anchor line inside the OS vendor's own ruleset, a host table,
 *   a generated Nix module, and an operator's ssh config. Declaring the WHOLE file would mean
 *   taking it from its owner — which puts it back, or refuses its next activation. So the resource
 *   owns the lines between two markers and promises that every other byte is untouched.
 * ⛔ THE REST OF THE FILE IS BYTE-IDENTICAL. Not "semantically the same", not re-indented, not
 *   re-terminated: the bytes before the BEGIN line and after the END line are copied through. That
 *   is the property region.test.ts asserts, because it is the whole reason the other owner tolerates
 *   this.
 * ⛔ AMBIGUITY IS A REFUSAL, NEVER A GUESS. Two BEGIN markers with the same name, an END before its
 *   BEGIN, or a BEGIN with no END all mean someone edited inside the block. Picking one would
 *   silently delete their edit, so each is an Error naming the line.
 * ★ THE MARKER IS A COMMENT IN THE HOST FILE'S OWN LANGUAGE, which is why the comment token is a
 *   prop: `#` covers the four consumers above, and a file whose comments are `//` or `;` says so.
 */

export type RegionSpec = {
  /** Distinguishes this block from any other managed block in the same file. */
  readonly name: string;
  /** The file's comment token. @default '#' */
  readonly comment?: string;
};

export const DEFAULT_COMMENT = '#';

const tokens = (spec: RegionSpec) => {
  const comment = spec.comment ?? DEFAULT_COMMENT;
  return {
    begin: `${comment} BEGIN ${spec.name}`,
    end: `${comment} END ${spec.name}`,
  };
};

export const regionProblems = (spec: RegionSpec): string[] => {
  const found: string[] = [];
  const comment = spec.comment ?? DEFAULT_COMMENT;
  if (!/^\S{1,4}$/.test(comment) || comment.includes('\u0000')) {
    found.push('region comment must be 1–4 non-space characters');
  }
  // ⛔ A marker must be one line and must be findable verbatim; a name with a newline would split
  //   it, and leading or trailing space would not match what we later search for.
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,79}$/.test(spec.name)) {
    found.push('region name must be 1–80 printable characters and start alphanumeric');
  }
  return found;
};

const refuse = (message: string): Error => new Error(`managed region: ${message}`);

const duplicate = (what: string, at: readonly number[], line: string): Error =>
  refuse(
    `${what} for ${JSON.stringify(line)} (lines ${at.map((index) => index + 1).join(', ')}). ` +
      'Remove the duplicate; this resource will not choose between them.',
  );

/** Where the block sits: the line indices of its markers, or `undefined` when it is not there. */
const locate = (lines: readonly string[], spec: RegionSpec) => {
  const { begin, end } = tokens(spec);
  const begins = lines.flatMap((line, index) => (line === begin ? [index] : []));
  const ends = lines.flatMap((line, index) => (line === end ? [index] : []));
  if (begins.length > 1) throw duplicate('two BEGIN markers', begins, begin);
  if (ends.length > 1) throw duplicate('two END markers', ends, end);
  const [from] = begins;
  const [to] = ends;
  if (from === undefined && to === undefined) return undefined;
  if (from === undefined || to === undefined) {
    throw refuse(
      `${JSON.stringify(spec.name)} has a ${from === undefined ? 'END' : 'BEGIN'} marker and no ` +
        'match. Repair the file by hand — a half-marked block means an edit inside it.',
    );
  }
  if (to < from) throw refuse(`${JSON.stringify(spec.name)} has its END marker before its BEGIN`);
  return { from, to };
};

/**
 * The file's bytes with the block set to `body`, appended at the end when it is not there yet.
 * ⚠️ A file that does not end in a newline gets one before the block is appended — the ONLY byte
 *   this function adds outside its own block, and without it the last existing line and the BEGIN
 *   marker would become one line.
 */
export const spliceRegion = (file: string, spec: RegionSpec, body: string): string => {
  const { begin, end } = tokens(spec);
  // ★ A body is stored as whole lines: exactly one newline after the last one, none doubled.
  const block = [begin, ...(body === '' ? [] : body.replace(/\n$/, '').split('\n')), end];
  const lines = file.split('\n');
  const found = locate(lines, spec);
  if (found !== undefined) {
    return [...lines.slice(0, found.from), ...block, ...lines.slice(found.to + 1)].join('\n');
  }
  const prefix = file === '' || file.endsWith('\n') ? file : `${file}\n`;
  return `${prefix}${block.join('\n')}\n`;
};

/** The block's body, or `undefined` when the file has no such block. */
export const readRegion = (file: string, spec: RegionSpec): string | undefined => {
  const lines = file.split('\n');
  const found = locate(lines, spec);
  if (found === undefined) return undefined;
  const body = lines.slice(found.from + 1, found.to);
  return body.length === 0 ? '' : `${body.join('\n')}\n`;
};

/**
 * The file with the block and both markers removed — what a delete leaves behind.
 * ★ Byte-for-byte the file as it was before the block was appended, with one exception already
 *   named on `spliceRegion`: a file that had no final newline when the block was added keeps the
 *   newline that adding it required. Nothing else is added or dropped.
 */
export const removeRegion = (file: string, spec: RegionSpec): string => {
  const lines = file.split('\n');
  const found = locate(lines, spec);
  if (found === undefined) return file;
  return [...lines.slice(0, found.from), ...lines.slice(found.to + 1)].join('\n');
};
