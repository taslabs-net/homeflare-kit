/**
 * Gate rule table — DO NOT EDIT BY HAND.
 *
 * Run: bun packages/typesafe/scripts/gen-gate-tables.ts
 *
 * Source: https://raw.githubusercontent.com/gitleaks/gitleaks/v8.30.1/config/gitleaks.toml
 *   sha256 e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf, 97731 bytes, fetched 2026-09-23T00:00:00Z, MIT
 * gen-gate-tables-rules.ts documents the dialect translation and why each dropped
 * rule could not be carried into a JS RegExp.
 * Rule ids, descriptions and regex sources below are gitleaks' own — MIT License,
 * Copyright (c) 2019 Zachary Rice. This file carries the notice; it does not relicense
 * anything here, which stays under this package's own MIT license as a derived work.
 */
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

export const GITLEAKS_TABLE_DIGEST = "7426dd084877f09ec4e39c44e9e7eaa1ff5f17dbe008192c49cd3d7d222640e9";

export { GITLEAKS_RULES_EMITTED } from './gitleaks-rules-emitted.ts';
export { GITLEAKS_RULES_DROPPED } from './gitleaks-rules-dropped.ts';
