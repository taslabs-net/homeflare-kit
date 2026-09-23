#!/usr/bin/env bun
/**
 * Live probe: does `cf-aig-collect-log: false` (the gateway transport's new default —
 * see ../src/gateway.ts's `collectLog` option) actually stop the AI Gateway from
 * keeping a log entry for the call? Decision 24 (Tim, 2026-09-23): one measurement
 * that the header takes effect on `/ai/run`, not just that it is sent.
 *
 * ⛔ CREDENTIAL HANDLING, same as scripts/probe-gateway.ts: reads ONLY
 *   `CF_AI_GATEWAY_TOKEN` and `CF_AI_GATEWAY_URL` from the `--env-file <path>`
 *   argument, in this process, and never prints, logs, or writes either value. The
 *   account id is derived from the URL and used, but never printed either.
 *
 * ⛔ NO ESTATE IDENTIFIERS HARDCODED HERE (public package): the gateway id is never a
 *   literal in this file — it comes from `--gateway-id`, the same as --env-file.
 *
 * ⛔ DATA LINE. The only text sent to Cloudflare/TypeSafe is the same canned public
 *   sentence scripts/probe-gateway.ts already uses.
 *
 * ★ COST AND CALL BUDGET. Exactly one billed `/ai/run` call (step 3). Steps 1, 2 and 4
 *   are metadata-only GETs against `AI Gateway Read` — no model spend.
 *
 * Usage: `bun run scripts/probe-collect-log.ts --env-file <path> --gateway-id <id>`
 */
import { readFile } from 'node:fs/promises';
import { createTypeSafeGatewayClient } from '../src/gateway.ts';

const SENTENCE = 'The library opens at nine in the morning on weekdays.';
const POLL_ATTEMPTS = 3;
const POLL_DELAY_MS = 20_000;

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

function accountIdFromUrl(url: string): string | undefined {
  const m = /\b([0-9a-f]{32})\b/.exec(new URL(url).pathname);
  return m?.[1];
}

interface LogEntry {
  readonly created_at?: unknown;
  readonly model?: unknown;
  readonly provider?: unknown;
  readonly success?: unknown;
}

/** `GET .../ai-gateway/gateways/{gatewayId}/logs` — same query shape every call here. */
async function listLogs(token: string, accountId: string, gatewayId: string): Promise<LogEntry[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways/${gatewayId}/logs` +
      '?order_by=created_at&order_by_direction=desc&per_page=50',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = (await res.json().catch(() => undefined)) as { result?: LogEntry[] } | undefined;
  if (!res.ok) throw new Error(`list logs: HTTP ${res.status}`);
  return body?.result ?? [];
}

/** Step 1: the gateway's own logging settings. */
async function printGatewaySettings(
  token: string,
  accountId: string,
  gatewayId: string,
): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways/${gatewayId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = (await res.json().catch(() => undefined)) as
    | { result?: { collect_logs?: unknown; log_management_strategy?: unknown } }
    | undefined;
  if (!res.ok) throw new Error(`get gateway: HTTP ${res.status}`);
  console.log('\n--- (1) gateway settings ---');
  console.log('collect_logs:', body?.result?.collect_logs);
  console.log('log_management_strategy:', body?.result?.log_management_strategy);
}

/** Step 2 (control): entries already logged in the previous 24h, before step 3 runs.
 *  Proves the account/gateway/token combination does produce log entries at all — so a
 *  later absence means the header worked, not that nothing was ever being logged. */
async function printControl(token: string, accountId: string, gatewayId: string): Promise<void> {
  const entries = await listLogs(token, accountId, gatewayId);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = entries.filter((e) => {
    const t = typeof e.created_at === 'string' ? Date.parse(e.created_at) : Number.NaN;
    return Number.isFinite(t) && t >= since;
  });
  console.log('\n--- (2) control: entries logged in the previous 24h ---');
  console.log('count:', recent.length);
  console.log('newest created_at:', recent[0]?.created_at);
}

/** Step 3: exactly one billed call, through the real gateway transport, default
 *  (unset) `collectLog` — i.e. `cf-aig-collect-log: false`. */
async function runOneCall(token: string, accountId: string, gatewayId: string): Promise<string> {
  let sawLogIdHeader: boolean | undefined;
  const t0 = new Date().toISOString();
  const client = createTypeSafeGatewayClient({
    accountId,
    token,
    gatewayId,
    retry: { maxRetries: 0 },
    fetch: async (url, init) => {
      const res = await globalThis.fetch(url, init);
      sawLogIdHeader = res.headers.has('cf-aig-log-id');
      return res;
    },
  });

  console.log('\n--- (3) one call, default collectLog ---');
  try {
    const { data, response } = await client
      .systemOne({
        state: SENTENCE,
        questions: { topic: { type: 'noul', instructions: 'about a library?' } },
      })
      .withResponse();
    console.log('status:', response.status);
    console.log('answering model:', data.model);
  } catch (err) {
    console.log('status: rejected —', err instanceof Error ? err.message : err);
  }
  console.log('cf-aig-log-id header present:', sawLogIdHeader ?? false);
  return t0;
}

/** Step 4: poll for entries at or after t0 — never their payload, only metadata. */
async function pollAfter(
  token: string,
  accountId: string,
  gatewayId: string,
  t0: string,
): Promise<void> {
  const t0Ms = Date.parse(t0);
  console.log('\n--- (4) polling for entries at or after the call ---');
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    const entries = await listLogs(token, accountId, gatewayId);
    const after = entries.filter((e) => {
      const t = typeof e.created_at === 'string' ? Date.parse(e.created_at) : Number.NaN;
      return Number.isFinite(t) && t >= t0Ms;
    });
    console.log(
      `attempt ${attempt}/${POLL_ATTEMPTS}: ${after.length} entr${after.length === 1 ? 'y' : 'ies'}`,
    );
    for (const e of after) {
      console.log('  ', {
        created_at: e.created_at,
        model: e.model,
        provider: e.provider,
        success: e.success,
      });
    }
    if (after.length > 0 || attempt === POLL_ATTEMPTS) return;
    await Bun.sleep(POLL_DELAY_MS);
  }
}

async function main(): Promise<void> {
  const envFileIdx = process.argv.indexOf('--env-file');
  const envFile = envFileIdx >= 0 ? process.argv[envFileIdx + 1] : undefined;
  const gatewayIdIdx = process.argv.indexOf('--gateway-id');
  const gatewayId = gatewayIdIdx >= 0 ? process.argv[gatewayIdIdx + 1] : undefined;
  if (!envFile || !gatewayId)
    throw new Error('usage: probe-collect-log.ts --env-file <path> --gateway-id <id>');

  const creds = await readEnvFile(envFile);
  const accountId = accountIdFromUrl(creds.url);
  if (!accountId) {
    throw new Error(
      'no 32-hex account id in CF_AI_GATEWAY_URL, and this script never guesses between accounts — ' +
        'pass it from the coordinator instead',
    );
  }

  await printGatewaySettings(creds.token, accountId, gatewayId);
  await printControl(creds.token, accountId, gatewayId);
  const t0 = await runOneCall(creds.token, accountId, gatewayId);
  await pollAfter(creds.token, accountId, gatewayId, t0);
}

await main();
