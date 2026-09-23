/**
 * Gate rules DROPPED from gitleaks config/gitleaks.toml — DO NOT EDIT BY HAND.
 *
 * Run: bun packages/typesafe/scripts/gen-gate-tables.ts
 *
 * Source: https://raw.githubusercontent.com/gitleaks/gitleaks/v8.30.1/config/gitleaks.toml
 *   sha256 e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf, 97731 bytes, fetched 2026-09-23T00:00:00Z, MIT
 * 36 rules — each is a regex this repo's Node >=22 floor cannot run, or a
 * dialect construct (POSIX class, named group) JS has no equivalent for. Not enforced.
 * Rule ids, descriptions and regex sources below are gitleaks' own — MIT License,
 * Copyright (c) 2019 Zachary Rice. This file carries the notice; it does not relicense
 * anything here, which stays under this package's own MIT license as a derived work.
 */
import type { DroppedGateRule } from './gitleaks-rules.ts';

export const GITLEAKS_RULES_DROPPED: readonly DroppedGateRule[] = [
  { id: "adobe-client-secret", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "airtable-personnal-access-token", reason: "POSIX bracket class ([[:...:]]) has no JS equivalent" },
  { id: "alibaba-access-key-id", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "atlassian-api-token", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "authress-service-client-access-key", reason: "does not compile as a JS RegExp: Invalid regular expression: invalid regular expression modifier" },
  { id: "cisco-meraki-api-key", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "cohere-api-token", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "curl-auth-header", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "doppler-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "duffel-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "dynatrace-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "easypost-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "easypost-test-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "etsy-access-token", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "facebook-page-access-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "flutterwave-encryption-key", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "flutterwave-public-key", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "flutterwave-secret-key", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "frameio-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "generic-api-key", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "gocardless-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "hashicorp-tf-api-token", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "intra42-client-secret", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "jwt-base64", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "kubernetes-secret-yaml", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "linear-api-key", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "okta-access-token", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "planetscale-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "planetscale-password", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "postman-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "privateai-api-token", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "sendgrid-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "sendinblue-api-token", reason: "does not compile as a JS RegExp: Invalid regular expression: unrecognized character after (?" },
  { id: "sumologic-access-id", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "sumologic-access-token", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
  { id: "telegram-bot-api-token", reason: "scoped modifier group (?flags:…) is not a Node ≥22-safe construct, and its body is not a simple case-foldable class" },
];
