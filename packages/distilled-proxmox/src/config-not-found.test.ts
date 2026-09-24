/** PVE 9.2.11 vendor-source fixtures; missing BackupJob GET also measured 2026-09-24. */
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import type { ProxmoxOpContext } from "./protocol.ts";
import * as Retry from "./retry.ts";
import * as pools from "./services/pools.ts";
import * as cluster from "./services/cluster.ts";
import * as nodes from "./services/nodes.ts";

const call = <A, E>(
  op: Effect.Effect<A, E, ProxmoxOpContext>,
  status: number,
  body: unknown,
) =>
  Effect.runPromise(
    op.pipe(
      Retry.none,
      Effect.provide(
        credentials({
          baseUrl: "https://pve.test:8006",
          tokenId: "test@pve!test",
          secret: "fake",
        }),
      ),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json(body, { status }),
              ),
            ),
          ),
        ),
      ),
      Effect.flip,
    ),
  );

describe("precise config absence tags", () => {
  for (const [name, op] of [
    ["item read", pools.getPool({ poolid: "absent" })],
    ["index read", pools.listPools({ poolid: "absent" })],
    ["item update", pools.putPool({ poolid: "absent" })],
    ["collection update", pools.putPools({ poolid: "absent" })],
    ["item delete", pools.deletePool({ poolid: "absent" })],
    ["collection delete", pools.deletePools({ poolid: "absent" })],
  ] as const) {
    test(`Pool ${name}`, async () => {
      expect(
        await call(op, 500, {
          data: null,
          message: "pool 'absent' does not exist\n",
        }),
      ).toMatchObject({ _tag: "PoolNotFound" });
    });
  }
  for (const [name, op] of [
    ["read", cluster.getClusterBackup({ id: "absent" })],
    ["delete", cluster.deleteClusterBackup({ id: "absent" })],
    ["volumes", cluster.getClusterBackupIncludedVolumes({ id: "absent" })],
  ] as const) {
    test(`BackupJob ${name}`, async () => {
      expect(
        await call(op, 400, {
          data: null,
          message: "Parameter verification failed.\n",
          errors: { id: "No such job 'absent'" },
        }),
      ).toMatchObject({ _tag: "BackupJobNotFound" });
    });
  }
  test("common HTTP failures remain in every operation's typed error union", async () => {
    const op = pools.getPool({ poolid: "absent" }).pipe(
      Effect.catchTag("NotFound", () =>
        Effect.fail({ _tag: "HandledNotFound" } as const),
      ),
      Effect.catchTag("Forbidden", () =>
        Effect.fail({ _tag: "HandledForbidden" } as const),
      ),
    );
    expect(
      await call(op, 404, { message: "missing", data: null }),
    ).toMatchObject({ _tag: "HandledNotFound" });
    expect(
      await call(op, 403, { message: "denied", data: null }),
    ).toMatchObject({ _tag: "HandledForbidden" });
  });
  test("MetricServer read and update have distinct absence messages", async () => {
    expect(
      await call(cluster.getClusterMetricsServer({ id: "absent" }), 500, {
        data: null,
        message: "status server entry 'absent' does not exist\n",
      }),
    ).toMatchObject({ _tag: "MetricServerNotFound" });
    expect(
      await call(
        cluster.putClusterMetricsServer({
          id: "absent",
          server: "localhost",
          port: "8086",
        }),
        500,
        {
          data: null,
          message: "no such server 'absent'\n",
        },
      ),
    ).toMatchObject({ _tag: "MetricServerNotFound" });
  });
  test("unrelated, multi-field, and differently named validation are not absence", async () => {
    for (const errors of [
      { id: "invalid configuration ID" },
      { id: "No such job 'absent'", schedule: "invalid schedule" },
      { comment: "No such job 'absent'" },
    ]) {
      expect(
        await call(cluster.getClusterBackup({ id: "absent" }), 400, {
          data: null,
          message: "Parameter verification failed.\n",
          errors,
        }),
      ).toMatchObject({ _tag: "ParameterVerificationFailed", errors });
    }
  });
  test("a pool containing guests and a generic server failure propagate", async () => {
    for (const message of [
      "pool 'absent' is not empty (contains VM 100)\n",
      "unrelated failure",
    ]) {
      expect(
        await call(pools.deletePool({ poolid: "absent" }), 500, {
          data: null,
          message,
        }),
      ).toMatchObject({ _tag: "InternalServerError" });
    }
  });
  test("missing backup text is not attached to unrelated operations", async () => {
    expect(
      await call(cluster.deleteClusterMetricsServer({ id: "absent" }), 400, {
        data: null,
        message: "Parameter verification failed.\n",
        errors: { id: "No such job 'absent'" },
      }),
    ).toMatchObject({ _tag: "ParameterVerificationFailed" });
  });
  test("network absence is the exact sole iface error on its GET only", async () => {
    const body = {
      data: null,
      message: "Parameter verification failed.\n",
      errors: { iface: "interface does not exist" },
    };
    expect(
      await call(
        nodes.getNodeNetwork({ node: "n2", iface: "vmbr9" }),
        400,
        body,
      ),
    ).toMatchObject({ _tag: "NetworkInterfaceNotFound" });
    expect(
      await call(
        nodes.putNodeNetwork2({ node: "n2", iface: "vmbr9", type: "bridge" }),
        400,
        body,
      ),
    ).toMatchObject({
      _tag: "ParameterVerificationFailed",
      errors: body.errors,
    });
    for (const errors of [
      { iface: "invalid interface name" },
      { iface: "interface does not exist", type: "invalid type" },
      { other: "interface does not exist" },
    ]) {
      expect(
        await call(nodes.getNodeNetwork({ node: "n2", iface: "vmbr9" }), 400, {
          ...body,
          errors,
        }),
      ).toMatchObject({ _tag: "ParameterVerificationFailed", errors });
    }
    for (const [status, tag] of [
      [403, "Forbidden"],
      [500, "InternalServerError"],
    ] as const) {
      expect(
        await call(
          nodes.getNodeNetwork({ node: "n2", iface: "vmbr9" }),
          status,
          body,
        ),
      ).toMatchObject({ _tag: tag });
    }
  });
});
