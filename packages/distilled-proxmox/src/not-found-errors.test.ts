/**
 * WI-3: proves each resource-specific not-found shape actually decodes
 * from PVE's real wire response — not just that the class exists and
 * carries a non-transient category (checked separately, by hand, with
 * `Category.isTransientError` against one instance of each class; see the
 * WI-3 report). Each fixture here is the literal or closely-paraphrased
 * text cited in the corresponding `patches/<segment>/_errors.json`
 * patch's own description.
 */
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { credentials } from "./credentials.ts";
import type { ProxmoxOpContext } from "./protocol.ts";
import * as Retry from "./retry.ts";
import {
  getAccessGroup,
  getAccessUser,
  GroupNotFound,
  UserNotFound,
} from "./services/access.ts";
import {
  CephFsNotFound,
  CephPoolNotFound,
  deleteNodeCephFs,
  getNodeCephPoolStatus,
} from "./services/nodes.ts";
import { getStorage, StorageNotFound } from "./services/storage.ts";

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

const flipped = <A, E>(
  effect: Effect.Effect<A, E, ProxmoxOpContext>,
  status: number,
  body: unknown,
) =>
  Effect.runPromise(
    effect.pipe(
      Retry.none,
      Effect.provide(Layer.mergeAll(fakePve(status, body), testCredentials)),
      Effect.flip,
    ),
  );

describe("WI-3 typed not-found errors decode from PVE's real wire shape", () => {
  test("a missing user's 500 decodes to UserNotFound", async () => {
    const error = await flipped(getAccessUser({ userid: "x@pve" }), 500, {
      message: "no such user ('x@pve')",
    });
    expect(error).toBeInstanceOf(UserNotFound);
  });

  test("a missing group's 500 decodes to GroupNotFound", async () => {
    const error = await flipped(getAccessGroup({ groupid: "ghosts" }), 500, {
      message: "group 'ghosts' does not exist",
    });
    expect(error).toBeInstanceOf(GroupNotFound);
  });

  test("a missing storage's 500 decodes to StorageNotFound", async () => {
    const error = await flipped(
      getStorage({ storage: "hf-measure-nonexistent-probe" }),
      500,
      {
        message: "storage 'hf-measure-nonexistent-probe' does not exist\n",
        data: null,
      },
    );
    expect(error).toBeInstanceOf(StorageNotFound);
  });

  test("a missing Ceph pool's 500 decodes to CephPoolNotFound", async () => {
    const error = await flipped(
      getNodeCephPoolStatus({ node: "n2", name: "ghost-pool" }),
      500,
      {
        data: null,
        message:
          "error with 'osd pool get': mon_cmd failed - unrecognized pool 'ghost-pool'\n",
      },
    );
    expect(error).toBeInstanceOf(CephPoolNotFound);
  });

  test("a missing Ceph filesystem's 500 (on destroy) decodes to CephFsNotFound", async () => {
    const error = await flipped(
      deleteNodeCephFs({ node: "n2", name: "ghost-fs" }),
      500,
      { message: "no such cephfs 'ghost-fs'\n" },
    );
    expect(error).toBeInstanceOf(CephFsNotFound);
  });
});
