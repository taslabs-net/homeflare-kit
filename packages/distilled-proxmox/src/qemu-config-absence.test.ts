/**
 * QEMU absence is the config-file sentence from AbstractConfig, not every 500.
 * qemu-server Qemu.pm routes GET/PUT through `{vmid}/config` and DELETE through `{vmid}`.
 */
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import type { ProxmoxOpContext } from "./protocol.ts";
import * as Retry from "./retry.ts";
import { deleteNodeQemu, getNodeQemuConfig } from "./services/nodes.ts";

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

const missing = {
  data: null,
  message: "Configuration file 'nodes/pve1/qemu-server/150.conf' does not exist\n",
};

describe("QEMU config absence", () => {
  test("config GET and guest DELETE share the missing-file tag", async () => {
    expect(
      await call(getNodeQemuConfig({ node: "pve1", vmid: "150" }), 500, missing),
    ).toMatchObject({ _tag: "QemuConfigNotFound" });
    expect(
      await call(deleteNodeQemu({ node: "pve1", vmid: "150" }), 500, missing),
    ).toMatchObject({ _tag: "QemuConfigNotFound" });
  });

  test("a container path, a running guest, and a bare 500 stay unrelated", async () => {
    for (const message of [
      "Configuration file 'nodes/pve1/lxc/150.conf' does not exist\n",
      "VM 150 is running - destroy failed\n",
      "unrelated failure",
    ]) {
      const error = await call(getNodeQemuConfig({ node: "pve1", vmid: "150" }), 500, {
        data: null,
        message,
      });
      expect(error).toMatchObject({ _tag: "InternalServerError" });
    }
  });
});
