/**
 * Ported from `packages/proxmox/src/protocol.test.ts` in this same
 * distilled clone — same bug class, same shape: a bare 400 (no `errors`
 * object) must decode to the non-retryable `BadRequest`, never the
 * `Category.withServerError`-tagged `UnknownProxmoxBackupError`. See
 * `protocol.ts`'s `unknownError` and `errors.ts`'s module header.
 *
 * Adds one test PVE's file does not need: the auth header itself, because
 * that is the one thing measurably different between the two packages
 * (`PBSAPIToken=<id>:<secret>`, colon separator — see `credentials.ts`'s
 * header) and a wrong separator fails SILENTLY AS A 401 with no other
 * symptom, per that same header's citation of the kit's own warning. All
 * of this runs against a fake `HttpClient` — no live PBS host is
 * contacted anywhere in this file.
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
  UnknownProxmoxBackupError,
} from "./errors.ts";
import * as Retry from "./retry.ts";
import { getVersion } from "./services/version.ts";

const testCredentials = credentials({
  tokenId: "backup@pbs!test",
  secret: "test-secret",
  baseUrl: "https://pbs.test:8007",
});

const fakePbs = (status: number, body: unknown) =>
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
    getVersion({}).pipe(
      Retry.none,
      Effect.provide(Layer.mergeAll(fakePbs(status, body), testCredentials)),
      Effect.flip,
    ),
  );

describe("protocol.ts error decoding", () => {
  test("a bare 400 (no `errors` object) is BadRequest, never UnknownProxmoxBackupError", async () => {
    const error = await call(400, { data: null, message: "invalid parameter" });
    expect(error).toBeInstanceOf(BadRequest);
    expect(error).not.toBeInstanceOf(UnknownProxmoxBackupError);
    expect(error).toMatchObject({ message: "invalid parameter" });
  });

  test("a 400 with an `errors` object is ParameterVerificationFailed, carrying the per-field messages", async () => {
    const error = await call(400, {
      data: null,
      message: "parameter verification failed",
      errors: { comment: "value may only be 128 characters long" },
    });
    expect(error).toBeInstanceOf(ParameterVerificationFailed);
    expect(error).toMatchObject({
      message: "parameter verification failed",
      errors: { comment: "value may only be 128 characters long" },
    });
  });

  test("a genuinely unmapped, non-5xx status still falls back to UnknownProxmoxBackupError", async () => {
    const error = await call(418, { data: null, message: "weird" });
    expect(error).toBeInstanceOf(UnknownProxmoxBackupError);
  });

  test('the {"data": ...} envelope is unwrapped before decode', async () => {
    const result = await Effect.runPromise(
      getVersion({}).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakePbs(200, {
              data: { version: "4.2.6", release: "4.2", repoid: "abc123" },
            }),
            testCredentials,
          ),
        ),
      ),
    );
    expect(result).toMatchObject({ version: "4.2.6", release: "4.2" });
  });
});

describe("credentials.ts auth header", () => {
  test("Authorization is PBSAPIToken=<id>:<secret> — colon, never `=` like PVE's PVEAPIToken", async () => {
    let seenAuth: string | undefined;
    const capturing = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          seenAuth = request.headers["authorization"];
          return HttpClientResponse.fromWeb(
            request,
            new Response(
              JSON.stringify({
                data: { version: "4.2.6", release: "4.2", repoid: "abc" },
              }),
              { status: 200 },
            ),
          );
        }),
      ),
    );
    await Effect.runPromise(
      getVersion({}).pipe(
        Effect.provide(Layer.mergeAll(capturing, testCredentials)),
      ),
    );
    expect(seenAuth).toBe("PBSAPIToken=backup@pbs!test:test-secret");
  });
});
