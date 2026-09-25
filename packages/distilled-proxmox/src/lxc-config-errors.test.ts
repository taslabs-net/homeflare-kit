/**
 * Exact installed pve-container6.1.13/libpve-guest-common-perl6.0.5 absence; never generic500.
 * ⛔ ATTACHED TO GET, PUT AND DELETE — all three call `AbstractConfig::load_config` first
 *   (patches/nodes/lxc-config-errors.json's own provenance) and raise byte-identical text; a
 *   PUT/DELETE against a container config a caller believes exists gets the same typed absence
 *   a GET would, not a generic 500 a retry policy or catchTag could mistake for transient.
 */
import { expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import type { ProxmoxOpContext } from "./protocol.ts";
import * as Retry from "./retry.ts";
import * as nodes from "./services/nodes.ts";

const missing =
  "Configuration file 'nodes/pve-test/lxc/900.conf' does not exist\n";
const call = <A, E>(
  op: Effect.Effect<A, E, ProxmoxOpContext>,
  status: number,
  message?: string,
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
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({ data: null, message }, { status }),
            ),
          ),
        ),
      ),
      Effect.flip,
    ),
  );

test("only exact container-config absence on GET becomes LxcConfigNotFound", async () => {
  const get = () => nodes.getNodeLxcConfig({ node: "pve-test", vmid: "900" });
  expect(await call(get(), 500, missing)).toMatchObject({
    _tag: "LxcConfigNotFound",
  });
  for (const message of [
    undefined,
    "got timeout\n",
    missing.replace("lxc", "qemu-server"),
    missing + "other error",
  ]) {
    expect(await call(get(), 500, message)).toMatchObject({
      _tag: "InternalServerError",
    });
  }
  expect(await call(get(), 403, missing)).toMatchObject({ _tag: "Forbidden" });
});

test("the same exact absence on PUT and DELETE also becomes LxcConfigNotFound", async () => {
  expect(
    await call(
      nodes.putNodeLxcConfig({ node: "pve-test", vmid: "900" }),
      500,
      missing,
    ),
  ).toMatchObject({ _tag: "LxcConfigNotFound" });
  expect(
    await call(
      nodes.deleteNodeLxc({ node: "pve-test", vmid: "900" }),
      500,
      missing,
    ),
  ).toMatchObject({ _tag: "LxcConfigNotFound" });
  // ⛔ STILL NOT ABSENCE ON PUT/DELETE EITHER — a generic failure on the write paths must stay
  //   generic, exactly like the GET-only assertions above.
  for (const message of ["got timeout\n", missing + "other error"]) {
    expect(
      await call(
        nodes.putNodeLxcConfig({ node: "pve-test", vmid: "900" }),
        500,
        message,
      ),
    ).toMatchObject({ _tag: "InternalServerError" });
    expect(
      await call(
        nodes.deleteNodeLxc({ node: "pve-test", vmid: "900" }),
        500,
        message,
      ),
    ).toMatchObject({ _tag: "InternalServerError" });
  }
});
