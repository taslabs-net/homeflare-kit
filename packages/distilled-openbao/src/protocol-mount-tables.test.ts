import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import { OpenBaoParseError } from "./errors.ts";
import * as Retry from "./retry.ts";
import { authListEnabledMethods, type MountInfo } from "./services/auth.ts";
import { mountsListSecretsEngines } from "./services/mounts.ts";

// Synthetic fixture from v2.6.2 vault/logical_system.go:871-928, not a live
// vault inventory. Nil options is legal; optional arrays may be absent.
const entry = {
  type: "approle",
  description: "fixture",
  accessor: "auth_fixture",
  uuid: "fixture-uuid",
  plugin_version: "",
  running_plugin_version: "v2.6.2+builtin",
  running_sha256: "",
  local: false,
  seal_wrap: false,
  external_entropy_access: false,
  options: null,
  config: { default_lease_ttl: 0, max_lease_ttl: 0, force_no_cache: false },
} satisfies MountInfo;

for (const [path, operation] of [
  ["/sys/auth", authListEnabledMethods],
  ["/sys/mounts", mountsListSecretsEngines],
] as const) {
  describe(path, () => {
    const call = (body: unknown, status = 200, raw = false) => {
      let calls = 0;
      const client = HttpClient.make((request) => {
        calls++;
        expect(request.method).toBe("GET");
        expect(new URL(request.url).pathname).toBe(`/v1${path}`);
        expect(request.headers["x-vault-request"]).toBe("true");
        expect(request.headers["x-vault-token"]).toBeUndefined();
        expect(request.headers["x-vault-namespace"]).toBe("fixture");
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(
              status === 204 ? null : raw ? String(body) : JSON.stringify(body),
              { status },
            ),
          ),
        );
      });
      const effect = operation({}).pipe(
        Retry.none,
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(HttpClient.HttpClient, client),
            credentials({ addr: "http://fake.invalid", namespace: "fixture" }),
          ),
        ),
      );
      return { effect, calls: () => calls };
    };

    test("dynamic nested mount paths and unknown metadata survive", async () => {
      const configured = {
        ...entry,
        type: "kv",
        options: { version: "2", custom_option: "yes" },
        deprecation_status: "supported",
        future_metadata: { key: "retained" },
        config: {
          ...entry.config,
          token_type: "default-service",
          listing_visibility: "unauth",
          audit_non_hmac_request_keys: ["mount-secret-marker"],
          audit_non_hmac_response_keys: [],
          passthrough_request_headers: ["X-Forwarded-For"],
          allowed_response_headers: ["X-Fixture"],
          future_config: { keep: true },
          user_lockout_config: {
            user_lockout_counter_reset_duration: 900,
            user_lockout_threshold: 5,
            user_lockout_duration: 900,
            user_lockout_disable: false,
          },
        },
      };
      const data = { "approle/": entry, "team/nested/": configured };
      const { effect, calls } = call({
        request_id: "synthetic",
        data,
        warnings: null,
      });
      const result = await Effect.runPromise(effect);
      // Indexed values are typed MountInfo | undefined, not {} or unknown.
      const type: string | undefined = result["team/nested/"]?.type;
      expect(type).toBe("kv");
      expect(result).toEqual(data);
      expect(calls()).toBe(1);
    });

    test("an explicit empty data map is a valid inventory", async () => {
      expect(await Effect.runPromise(call({ data: {} }).effect)).toEqual({});
    });

    for (const [name, body] of [
      ["no envelope", {}],
      ["null body", null],
      ["no data", { request_id: "fixture" }],
      ["null data", { data: null }],
      ["array data", { data: [] }],
      ["scalar data", { data: "mount-secret-marker" }],
      ["null entry", { data: { "x/": null } }],
      ["empty entry", { data: { "x/": {} } }],
      [
        "invalid field",
        {
          data: {
            "x/": { ...entry, type: "mount-secret-marker", local: "false" },
          },
        },
      ],
      [
        "invalid config",
        {
          data: {
            "x/": {
              ...entry,
              config: { ...entry.config, max_lease_ttl: "60" },
            },
          },
        },
      ],
      [
        "invalid options",
        { data: { "x/": { ...entry, options: { version: 2 } } } },
      ],
      [
        "invalid lockout",
        {
          data: {
            "x/": {
              ...entry,
              config: { ...entry.config, user_lockout_config: {} },
            },
          },
        },
      ],
    ] as const) {
      test(`rejects ${name} without exposing response values`, async () => {
        const { effect, calls } = call(body);
        const error = await Effect.runPromise(effect.pipe(Effect.flip));
        expect(error).toBeInstanceOf(OpenBaoParseError);
        expect(error).toMatchObject({ body: undefined });
        expect(JSON.stringify(error)).not.toContain("mount-secret-marker");
        expect(calls()).toBe(1);
      });
    }

    for (const [status, text] of [
      [200, ""],
      [200, "mount-secret-marker: invalid JSON"],
      [204, ""],
    ] as const) {
      test(`rejects ${status} empty or invalid JSON safely`, async () => {
        const error = await Effect.runPromise(
          call(text, status, true).effect.pipe(Effect.flip),
        );
        expect(error).toBeInstanceOf(OpenBaoParseError);
        expect(JSON.stringify(error)).not.toContain("mount-secret-marker");
      });
    }

    for (const [status, tag] of [
      [401, "Unauthorized"],
      [403, "Forbidden"],
      [404, "NotFound"],
      [500, "InternalServerError"],
    ] as const) {
      test(`${status} remains a typed HTTP failure, never an empty map`, async () => {
        const { effect, calls } = call({ errors: ["fixture refusal"] }, status);
        expect(await Effect.runPromise(effect.pipe(Effect.flip))).toMatchObject(
          { _tag: tag },
        );
        expect(calls()).toBe(1);
      });
    }
  });
}
