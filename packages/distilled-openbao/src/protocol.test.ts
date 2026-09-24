/**
 * Proves the two measured, package-specific rules in `protocol.ts`: the
 * `{"errors": [...]}` envelope (often empty — the common 404 shape) and the
 * `data`-envelope unwrap on 2xx bodies. Same pattern as
 * `@distilled.cloud/proxmox`'s `protocol.test.ts` (a fake `HttpClient`
 * layer in front of a real generated operation), written after that file's
 * own history: an adversarial review is what caught the proxmox bug this
 * pattern exists to stop recurring, so OpenBao gets the same coverage from
 * the start rather than after its own incident.
 */
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import { Forbidden, UnknownOpenBaoError } from "./errors.ts";
import * as Retry from "./retry.ts";
import { PolicyNotFound, policiesReadAclPolicy } from "./services/policies.ts";

const testCredentials = credentials({
  token: "test-token",
  addr: "http://127.0.0.1:8299",
  namespace: "homeflare",
});

const fakeOpenBao = (status: number, body: unknown) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() =>
        HttpClientResponse.fromWeb(
          request,
          new Response(body === undefined ? undefined : JSON.stringify(body), {
            status,
          }),
        ),
      ),
    ),
  );

const readAbsent = (status: number, body: unknown) =>
  Effect.runPromise(
    policiesReadAclPolicy({ name: "zz-probe-absent" }).pipe(
      Retry.none,
      Effect.provide(
        Layer.mergeAll(fakeOpenBao(status, body), testCredentials),
      ),
      Effect.flip,
    ),
  );

describe("protocol.ts error decoding", () => {
  test("a 404 with an EMPTY errors array (the measured absent-policy shape) is PolicyNotFound", async () => {
    // Measured on OpenBao 2.6.2, 2026-09-24: GET sys/policies/acl/<absent>
    // answers exactly this — see patches/policies/_errors.json.
    const error = await readAbsent(404, { errors: [] });
    expect(error).toBeInstanceOf(PolicyNotFound);
  });

  test("a 403 with an errors array falls back to core's status map (Forbidden), joined", async () => {
    const error = await readAbsent(403, {
      errors: ["permission denied", "token expired"],
    });
    expect(error).toBeInstanceOf(Forbidden);
    expect(error).toMatchObject({
      message: "permission denied; token expired",
    });
  });

  // 418 is neither in HTTP_STATUS_MAP nor >= 500 (the unmapped-5xx fallback
  // in core's makeRestProtocol answers InternalServerError for those before
  // unknownError is ever reached).
  test("a genuinely unmapped, non-5xx status still falls back to UnknownOpenBaoError", async () => {
    const error = await readAbsent(418, { errors: ["teapot"] });
    expect(error).toBeInstanceOf(UnknownOpenBaoError);
  });

  test('the {"data": ...} envelope is unwrapped before decode', async () => {
    const result = await Effect.runPromise(
      policiesReadAclPolicy({ name: "agent" }).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeOpenBao(200, {
              request_id: "r-1",
              lease_id: "",
              renewable: false,
              lease_duration: 0,
              data: { name: "agent", policy: 'path "secret/*" {}', version: 1 },
              wrap_info: null,
              warnings: null,
              auth: null,
            }),
            testCredentials,
          ),
        ),
      ),
    );
    expect(result).toMatchObject({
      name: "agent",
      policy: 'path "secret/*" {}',
    });
  });

  test("sys/health-shaped bodies (no data envelope) pass through unchanged", async () => {
    // Not every endpoint is a logical response — sys/health answers its
    // fields at the top level, with no `data` wrapper. This operation never
    // calls that endpoint; the test exercises transformResponse directly
    // through a 2xx body that happens to have no `data` field, confirming
    // the unwrap only fires when one is actually present.
    const result = await Effect.runPromise(
      policiesReadAclPolicy({ name: "agent" }).pipe(
        Effect.provide(
          Layer.mergeAll(
            fakeOpenBao(200, { name: "agent", policy: "" }),
            testCredentials,
          ),
        ),
      ),
    );
    expect(result).toMatchObject({ name: "agent", policy: "" });
  });
});
