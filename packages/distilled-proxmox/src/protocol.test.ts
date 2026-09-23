/**
 * Proves the exact bug an adversarial review of this package caught and
 * this file exists to stop recurring: a bare PVE 400 (no `errors` object)
 * must decode to the non-retryable `BadRequest`, never the
 * `Category.withServerError`-tagged `UnknownProxmoxError` — core's default
 * retry policy treats `ServerError` as transient, so the wrong class would
 * have silently retried a permanent, caller-caused failure several times
 * before surfacing it. See `protocol.ts`'s `unknownError` and
 * `errors.ts`'s module header for the full account.
 */
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import {
  BadRequest,
  ParameterVerificationFailed,
  UnknownProxmoxError,
} from "./errors.ts";
import * as Retry from "./retry.ts";
import { getNodeTime } from "./services/nodes.ts";

const testCredentials = credentials({
  tokenId: "root@pam!test",
  secret: "test-secret",
  baseUrl: "https://pve.test:8006",
});

const fakePve = (status: number, body: unknown) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() =>
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), { status }),
        ),
      ),
    ),
  );

const call = (status: number, body: unknown) =>
  Effect.runPromise(
    getNodeTime({ node: "pve1" }).pipe(
      Retry.none,
      Effect.provide(Layer.mergeAll(fakePve(status, body), testCredentials)),
      Effect.flip,
    ),
  );

describe("protocol.ts error decoding", () => {
  test("a bare 400 (no `errors` object) is BadRequest, never UnknownProxmoxError", async () => {
    const error = await call(400, { data: null, message: "invalid parameter" });
    expect(error).toBeInstanceOf(BadRequest);
    expect(error).not.toBeInstanceOf(UnknownProxmoxError);
    expect(error).toMatchObject({ message: "invalid parameter" });
  });

  test("a 400 with an `errors` object is ParameterVerificationFailed, carrying the per-field messages", async () => {
    const error = await call(400, {
      data: null,
      message: "Parameter verification failed.",
      errors: { comment: "value may only be 128 characters long" },
    });
    expect(error).toBeInstanceOf(ParameterVerificationFailed);
    expect(error).toMatchObject({
      message: "Parameter verification failed.",
      errors: { comment: "value may only be 128 characters long" },
    });
  });

  // 418 is neither in PROXMOX_STATUS_MAP nor >= 500 (the unmapped-5xx
  // fallback in core's makeRestProtocol answers a bare `InternalServerError`
  // for those before `unknownError` is ever reached — see that decode step).
  test("a genuinely unmapped, non-5xx status still falls back to UnknownProxmoxError", async () => {
    const error = await call(418, { data: null, message: "weird" });
    expect(error).toBeInstanceOf(UnknownProxmoxError);
  });

  test('the {"data": ...} envelope is unwrapped before decode', async () => {
    const result = await Effect.runPromise(
      getNodeTime({ node: "pve1" }).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakePve(200, {
              data: {
                time: 1700000000,
                timezone: "UTC",
                localtime: 1700000000,
              },
            }),
            testCredentials,
          ),
        ),
      ),
    );
    expect(result).toMatchObject({ time: 1700000000, timezone: "UTC" });
  });
});
