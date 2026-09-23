/**
 * Renders gen-gate-tables.ts's classified rules and parsed IANA ranges into the four
 * generated/*.ts file bodies — kept separate from the fetch/verify/write orchestration
 * in gen-gate-tables.ts so that file stays under the house's 250-line cap.
 */
import type { SpecialRange } from './gen-gate-tables-ranges.ts';
import type { DroppedRule, EmittedRule } from './gen-gate-tables-rules.ts';

export interface RenderSource {
  readonly sourceUrl: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly fetchedAt: string;
  readonly license: string;
}

function header(title: string, sources: readonly RenderSource[], extra: readonly string[]): string {
  const lines = [
    '/**',
    ` * ${title} — DO NOT EDIT BY HAND.`,
    ' *',
    ' * Run: bun packages/typesafe/scripts/gen-gate-tables.ts',
    ' *',
    ...sources.map(
      (s) =>
        ` * Source: ${s.sourceUrl}\n *   sha256 ${s.sha256}, ${s.bytes} bytes, fetched ${s.fetchedAt}, ${s.license}`,
    ),
    ...extra.map((e) => ` * ${e}`),
    ' */',
  ];
  return lines.join('\n');
}

const GITLEAKS_NOTICE = [
  "Rule ids, descriptions and regex sources below are gitleaks' own — MIT License,",
  'Copyright (c) 2019 Zachary Rice. This file carries the notice; it does not relicense',
  "anything here, which stays under this package's own MIT license as a derived work.",
];

export function renderRulesIndex(source: RenderSource, digest: string): string {
  return `${header(
    'Gate rule table',
    [source],
    [
      'gen-gate-tables-rules.ts documents the dialect translation and why each dropped',
      'rule could not be carried into a JS RegExp.',
      ...GITLEAKS_NOTICE,
    ],
  )}
export interface GateRule {
  readonly id: string;
  readonly description: string;
  readonly source: string;
  readonly flags: string;
  readonly entropy?: number;
  readonly secretGroup?: number;
}

export interface DroppedGateRule {
  readonly id: string;
  readonly reason: string;
}

export const GITLEAKS_TABLE_DIGEST = ${JSON.stringify(digest)};

export { GITLEAKS_RULES_EMITTED } from './gitleaks-rules-emitted.ts';
export { GITLEAKS_RULES_DROPPED } from './gitleaks-rules-dropped.ts';
`;
}

function renderRuleField(r: { entropy?: number; secretGroup?: number }): string {
  const parts: string[] = [];
  if (r.entropy !== undefined) parts.push(`entropy: ${r.entropy}`);
  if (r.secretGroup !== undefined) parts.push(`secretGroup: ${r.secretGroup}`);
  return parts.length > 0 ? `, ${parts.join(', ')}` : '';
}

export function renderEmitted(source: RenderSource, rules: readonly EmittedRule[]): string {
  const rows = rules
    .map(
      (r) =>
        `  { id: ${JSON.stringify(r.id)}, description: ${JSON.stringify(r.description)}, source: ${JSON.stringify(r.source)}, flags: ${JSON.stringify(r.flags)}${renderRuleField(r)} },`,
    )
    .join('\n');
  return `${header(
    'Gate rules emitted from gitleaks config/gitleaks.toml',
    [source],
    [
      `${rules.length} rules, rule sources as STRINGS (never regex literals) — scan.ts compiles`,
      'each lazily with new RegExp inside try/catch and fails the whole gate closed if any one',
      'does not compile at runtime.',
      ...GITLEAKS_NOTICE,
    ],
  )}
import type { GateRule } from './gitleaks-rules.ts';

export const GITLEAKS_RULES_EMITTED: readonly GateRule[] = [
${rows}
];
`;
}

export function renderDropped(source: RenderSource, rules: readonly DroppedRule[]): string {
  const rows = rules
    .map((r) => `  { id: ${JSON.stringify(r.id)}, reason: ${JSON.stringify(r.reason)} },`)
    .join('\n');
  return `${header(
    'Gate rules DROPPED from gitleaks config/gitleaks.toml',
    [source],
    [
      `${rules.length} rules — each is a regex this repo's Node >=22 floor cannot run, or a`,
      'dialect construct (POSIX class, named group) JS has no equivalent for. Not enforced.',
      ...GITLEAKS_NOTICE,
    ],
  )}
import type { DroppedGateRule } from './gitleaks-rules.ts';

export const GITLEAKS_RULES_DROPPED: readonly DroppedGateRule[] = [
${rows}
];
`;
}

export function renderRanges(
  v4Source: RenderSource,
  v6Source: RenderSource,
  v4: readonly SpecialRange[],
  v6: readonly SpecialRange[],
): string {
  const all = [...v4, ...v6];
  const rows = all
    .map(
      (r) =>
        `  { cidr: ${JSON.stringify(r.cidr)}, name: ${JSON.stringify(r.name)}, family: ${r.family}, refuseByDefault: ${r.refuseByDefault}, category: ${JSON.stringify(r.category)} },`,
    )
    .join('\n');
  return `${header(
    'IANA special-purpose address ranges',
    [v4Source, v6Source],
    [
      'refuseByDefault covers Private-Use, Shared Address Space, Unique-Local and the two',
      'link-local rows — a REVIEWED CONSTANT (gen-gate-tables-ranges.ts), not vendor data.',
      'Loopback and every Documentation range are recorded (category) but refuse only when',
      'the caller opts in via gate options.',
    ],
  )}
export interface SpecialRange {
  readonly cidr: string;
  readonly name: string;
  readonly family: 4 | 6;
  readonly refuseByDefault: boolean;
  readonly category: 'default-refuse' | 'loopback' | 'documentation' | 'recorded-only';
}

export const SPECIAL_RANGES: readonly SpecialRange[] = [
${rows}
];
`;
}
