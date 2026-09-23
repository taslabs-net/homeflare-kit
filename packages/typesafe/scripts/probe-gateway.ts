#!/usr/bin/env bun
/**
 * Live probe for the Cloudflare AI Gateway catalog route — NEVER wired into
 * check/test/CI (grep repo-wide for this filename in package.json scripts and the
 * GitHub workflows to confirm before relying on that).
 *
 * ⛔ CREDENTIAL HANDLING. Reads ONLY `CF_AI_GATEWAY_TOKEN` and `CF_AI_GATEWAY_URL` from
 *   the `--env-file <path>` argument, in this process, and never prints, logs, or
 *   writes either value. Nothing here takes a credential on argv or in a child
 *   process's env.
 *
 * ⛔ DATA LINE. The only text sent to Cloudflare/TypeSafe is one canned public sentence
 *   this file defines below — never repository, estate, or user content.
 *
 * ★ WHEN TO RUN THIS. Before trusting it again, check whether
 *   plugins/homeflare-workflows/skills/typesafe-ai/references/ai-gateway.md already
 *   answers the question — that doc is the estate's live-verified record of this exact
 *   route. Re-run only when that doc is stale, disputed, or missing the specific fact
 *   you need; a duplicate run spends a live BYOK-billed call for no new information.
 *
 * Usage: `bun run scripts/probe-gateway.ts --env-file /opt/homeflare/env/ai-gateway.env`
 */
import { readFile } from 'node:fs/promises';

const SENTENCE = 'The library opens at nine in the morning on weekdays.';

interface EnvCreds {
  readonly token: string;
  readonly url: string;
}

async function readEnvFile(path: string): Promise<EnvCreds> {
  const text = await readFile(path, 'utf8');
  let token: string | undefined;
  let url: string | undefined;
  for (const line of text.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    if (m[1] === 'CF_AI_GATEWAY_TOKEN') token = m[2];
    if (m[1] === 'CF_AI_GATEWAY_URL') url = m[2];
  }
  if (!token || !url)
    throw new Error('env file is missing CF_AI_GATEWAY_TOKEN or CF_AI_GATEWAY_URL');
  return { token, url };
}

/** Prints the URL's SHAPE only: host, and whether a 32-hex segment is present. */
function describeUrlShape(url: string): { readonly host: string; readonly hasHexId: boolean } {
  const u = new URL(url);
  return { host: u.host, hasHexId: /\b[0-9a-f]{32}\b/.test(u.pathname) };
}

function accountIdFromUrl(url: string): string | undefined {
  const m = /\b([0-9a-f]{32})\b/.exec(new URL(url).pathname);
  return m?.[1];
}

interface ProbeCall {
  readonly label: string;
  readonly inputModel?: string;
  readonly malformed?: boolean;
}

const CALLS: readonly ProbeCall[] = [
  { label: 'baseline' },
  { label: 'pin jev-1.13.0', inputModel: 'jev-1.13.0' },
  { label: 'pin jev-0.0.0', inputModel: 'jev-0.0.0' },
  { label: 'malformed question', malformed: true },
];

async function runOne(
  creds: EnvCreds,
  accountId: string,
  gatewayId: string,
  call: ProbeCall,
): Promise<void> {
  const questions = call.malformed
    ? { bad: { type: 'not-a-real-type' } }
    : { topic: { type: 'noul', instructions: 'Is this about a library?' } };
  const input: Record<string, unknown> = { state: SENTENCE, questions };
  if (call.inputModel) input.model = call.inputModel;

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'cf-aig-gateway-id': gatewayId,
      'cf-aig-no-wholesale': 'true',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ model: 'typesafe/jev', input }),
  });

  const body = (await res.json().catch(() => undefined)) as
    | {
        result?: {
          result?: { model?: unknown; answers?: Record<string, unknown> };
          gatewayMetadata?: { keySource?: unknown };
        };
        errors?: ReadonlyArray<{ code?: unknown; message?: unknown }>;
      }
    | undefined;

  console.log(`\n--- ${call.label} ---`);
  console.log('status:', res.status);
  console.log('model:', body?.result?.result?.model);
  console.log('keySource:', body?.result?.gatewayMetadata?.keySource);
  const answers = body?.result?.result?.answers ?? {};
  console.log(
    'answer keys/types:',
    Object.fromEntries(
      Object.entries(answers).map(([k, v]) => [k, (v as { type?: unknown })?.type]),
    ),
  );
  console.log('envelope keys:', body ? Object.keys(body) : []);
  console.log(
    'errors:',
    (body?.errors ?? []).map((e) => ({ code: e.code, message: e.message })),
  );
  console.log('response header NAMES:', [...res.headers.keys()]);
}

async function main(): Promise<void> {
  const envFileIdx = process.argv.indexOf('--env-file');
  const envFile = envFileIdx >= 0 ? process.argv[envFileIdx + 1] : undefined;
  if (!envFile) throw new Error('usage: probe-gateway.ts --env-file <path>');

  const creds = await readEnvFile(envFile);
  const shape = describeUrlShape(creds.url);
  console.log('CF_AI_GATEWAY_URL host:', shape.host, '— 32-hex id present:', shape.hasHexId);

  const accountId = accountIdFromUrl(creds.url);
  if (!accountId) {
    throw new Error(
      'no 32-hex account id in CF_AI_GATEWAY_URL, and this script never guesses between accounts — ' +
        'pass it from the coordinator instead',
    );
  }
  const gatewayId = 'homeflare-ai-gateway';

  for (const call of CALLS) {
    await runOne(creds, accountId, gatewayId, call);
  }
}

await main();
