/**
 * Fixtures shaped from the probe recorded in
 * plugins/homeflare-workflows/skills/typesafe-ai/references/ai-gateway.md (measured
 * 2026-09-23, live). Every identifier below is fake: a 32-hex example account id and
 * `example-gateway`, never an estate value — this package is published publicly.
 */

export const FAKE_ACCOUNT_ID: string = '0123456789abcdef0123456789abcdef';
export const FAKE_GATEWAY_ID: string = 'example-gateway';
export const FAKE_TOKEN: string = 'fake-ai-gateway-token';

interface CloudflareSuccessEnvelope {
  readonly success: boolean;
  readonly result: {
    readonly result?: {
      readonly model: string;
      readonly answers: unknown;
      readonly usage: unknown;
    };
    readonly gatewayMetadata: { readonly keySource: string };
  };
  readonly errors: ReadonlyArray<{ readonly code: number; readonly message: string }>;
  readonly messages: ReadonlyArray<unknown>;
}

/** Shape of a successful `/ai/run` call, per the measured route doc. */
export const SUCCESS_ENVELOPE: CloudflareSuccessEnvelope = {
  success: true,
  result: {
    result: {
      model: 'jev-1.13.0',
      answers: { billing: { type: 'noul', noul: 0.87 } },
      usage: { input_tokens: 42, output_tokens: 0 },
    },
    gatewayMetadata: { keySource: 'BYOK' },
  },
  errors: [],
  messages: [],
};

/** An unexpected-but-2xx body: no `result.result`. */
export const MALFORMED_2XX_ENVELOPE: CloudflareSuccessEnvelope = {
  success: true,
  result: { gatewayMetadata: { keySource: 'BYOK' } },
  errors: [],
  messages: [],
};

interface CloudflareErrorEnvelope {
  readonly success: false;
  readonly result: null;
  readonly errors: ReadonlyArray<{ readonly code: number; readonly message: string }>;
}

/** Cloudflare's error envelope shape (`cf-aig-no-wholesale` refusal, per the changelog). */
export function errorEnvelope(code: number, message: string): CloudflareErrorEnvelope {
  return { success: false, result: null, errors: [{ code, message }] };
}

export const NO_WHOLESALE_400: CloudflareErrorEnvelope = errorEnvelope(
  2016,
  'no applicable credentials for this request',
);
export const AUTH_401: CloudflareErrorEnvelope = errorEnvelope(10000, 'authentication error');
