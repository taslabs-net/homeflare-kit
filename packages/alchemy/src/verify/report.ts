/**
 * The verifier's answer, for a terminal and for a gate.
 *
 * ⛔ NAMES, NEVER VALUES. A row lists which declared fields differ from the live object, not what
 *   either side holds: the tool runs over any stack, and a prop or an attribute can be a secret.
 *   `alchemy plan --detailed` shows declared values; the family's own read shows live ones.
 */
import type { AdoptRow } from './rows.ts';
import type { AdoptReport } from './verify.ts';

/** 0 when every reported row is a no-op, 1 when any is not. (2 is the CLI's: it could not tell.) */
export const exitCodeOf = (report: AdoptReport): 0 | 1 =>
  report.rows.every((row) => row.ok) ? 0 : 1;

const pad = (text: string, width: number) => text.padEnd(width);

const line = (row: AdoptRow, widths: { planned: number; type: number }) => {
  const head = [
    row.ok ? 'ok  ' : 'FAIL',
    pad(row.planned, widths.planned),
    pad(row.diff, 8),
    pad(row.read, 9),
    pad(row.type, widths.type),
    row.fqn,
  ].join('  ');
  const changed = row.changed.length > 0 ? `  changed: ${row.changed.join(', ')}` : '';
  return row.why === '' ? `${head}${changed}` : `${head}${changed}\n      ${row.why}`;
};

/** Plain text, one row per line, with the reason under any row that is not a no-op. */
export const formatReport = (report: AdoptReport, all: boolean): string => {
  const scope = all ? 'every row' : 'rows without state';
  const title = `hf-adopt-verify ${report.stack}/${report.stage}: ${String(report.rows.length)} ${scope} (of ${String(report.declared)} declared)`;
  if (report.rows.length === 0) {
    return `${title}\nnothing to verify — every declared row already has state. --all checks those too.\n`;
  }
  const widths = {
    planned: Math.max(7, ...report.rows.map((row) => row.planned.length)),
    type: Math.max(4, ...report.rows.map((row) => row.type.length)),
  };
  const header = ['    ', pad('planned', widths.planned), pad('diff', 8), pad('read', 9)]
    .concat([pad('type', widths.type), 'fqn'])
    .join('  ');
  const failed = report.rows.filter((row) => !row.ok).length;
  const verdict =
    failed === 0
      ? 'every row is a no-op: the deploy writes nothing to them'
      : `${String(failed)} row(s) are NOT a no-op: the deploy would write, create or delete`;
  return [title, '', header, ...report.rows.map((row) => line(row, widths)), '', verdict, ''].join(
    '\n',
  );
};
