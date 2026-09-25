/**
 * The interfaces diff is a sibling of `data`. Generic unwrapping must not drop it,
 * and a response without that sibling must still unwrap.
 */
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import type { ProxmoxOpContext } from "./protocol.ts";
import * as Retry from "./retry.ts";
import { getNodeTime, listNodeNetwork } from "./services/nodes.ts";

const creds = credentials({
  tokenId: "root@pam!test",
  secret: "test-secret",
  baseUrl: "https://pve.test:8006",
});

const http = (body: unknown) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(request, Response.json(body, { status: 200 })),
      ),
    ),
  );

const run = <A, E>(op: Effect.Effect<A, E, ProxmoxOpContext>, body: unknown) =>
  Effect.runPromise(op.pipe(Retry.none, Effect.provide(Layer.mergeAll(http(body), creds))));

describe("network changes sibling", () => {
  test("a staged interfaces diff survives beside data", async () => {
    const changes = "--- a\n+++ b\n+wpa-psk secret-value\n";
    const live = await run(
      listNodeNetwork({ node: "pve1" }),
      { data: [{ iface: "vmbr0", type: "bridge" }], changes },
    );
    expect(live).toEqual({
      data: [{ iface: "vmbr0", type: "bridge" }],
      changes,
    });
  });

  test("no changes sibling still unwraps to the interface list", async () => {
    const live = await run(listNodeNetwork({ node: "pve1" }), {
      data: [{ iface: "vmbr0", type: "bridge" }],
    });
    expect(live).toEqual([{ iface: "vmbr0", type: "bridge" }]);
  });

  test("another operation still unwraps data and ignores no sibling", async () => {
    const live = await run(getNodeTime({ node: "pve1" }), {
      data: { time: 1_700_000_000 },
    });
    expect(live).toMatchObject({ time: 1_700_000_000 });
  });
});
