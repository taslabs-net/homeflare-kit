/**
 * Which of a parameter's vendor rules the plan-time guard actually checks.
 *
 * 🔴 THE REPORT SAID `comment` ON `POST /config/verify` WAS UNENFORCED, AND IT IS THE ONE RULE
 *   THAT NOW STOPS THE DEPLOY. `docs/api-coverage.md` was generated from the vendor schema alone,
 *   hours after `packages/alchemy/src/proxmox/generated/constraints/` started enforcing 321 rows of
 *   it. The gap column therefore counted every rule the guard had just closed — including the
 *   128-character limit the whole report opens by describing. A coverage report that does not know
 *   what the repository enforces is a coverage report of nothing.
 *
 * ⛔ `format` IS NEVER SUBTRACTED. The constraint tables RECORD a format name and check nothing,
 *   because the name is a validator the vendor implements server-side and publishes nothing about.
 *   Subtracting it would turn "we wrote the name down" into "we check it".
 * ⛔ A `pattern` COUNTS AS ENFORCED ONLY WHEN THE ROW CARRIES ONE. A row with `patternSource` and
 *   no `pattern` is a rule the generator could not translate faithfully and deliberately dropped.
 */
import { PROXMOX_CONSTRAINTS } from '../packages/alchemy/src/proxmox/generated/constraints/index.ts';

/** The rule kinds `constraints.ts` compares. ⚠️ `enum` is out: the generated TYPES already hold it. */
const CHECKED = ['maxLength', 'minLength', 'minimum', 'maximum', 'pattern'] as const;

const EMPTY: ReadonlySet<string> = new Set();

export const enforcedKinds = (
  product: string,
  method: string,
  path: string,
  param: string,
): ReadonlySet<string> => {
  const row = PROXMOX_CONSTRAINTS[`${product}:${method} ${path}`]?.[param] as
    | Record<string, unknown>
    | undefined;
  if (row === undefined) return EMPTY;
  return new Set(CHECKED.filter((kind) => row[kind] !== undefined));
};

/** How many endpoints of this product the guard has a table for — the report states it. */
export const tabledEndpoints = (product: string): number =>
  Object.keys(PROXMOX_CONSTRAINTS).filter((key) => key.startsWith(`${product}:`)).length;
