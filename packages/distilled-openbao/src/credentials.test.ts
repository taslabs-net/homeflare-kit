/**
 * Proves `normalizeBaseUrl`'s trailing-slash trim is a linear scan, not the
 * `/\/+$/` regex CodeQL flagged as js/polynomial-redos (alert 15 on kit PR
 * 263): a long run of `/` must normalize correctly AND fast, not just
 * correctly — a passing assertion alone wouldn't prove the fix, since the
 * regex it replaces was also correct, just slow on adversarial input.
 */
import { describe, expect, test } from "bun:test";
import { normalizeBaseUrl } from "./credentials.ts";

describe("normalizeBaseUrl", () => {
  test("drops a single trailing slash and appends /v1", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:8200/")).toBe(
      "http://127.0.0.1:8200/v1",
    );
  });

  test("leaves an already-complete /v1 root alone", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:8200/v1")).toBe(
      "http://127.0.0.1:8200/v1",
    );
  });

  test("a long run of trailing slashes normalizes correctly and in linear time", () => {
    const pathological = `http://127.0.0.1:8200${"/".repeat(50_000)}`;
    const start = performance.now();
    const result = normalizeBaseUrl(pathological);
    const elapsedMs = performance.now() - start;

    expect(result).toBe("http://127.0.0.1:8200/v1");
    // The polynomial regex this replaced would visibly stall (seconds, not
    // milliseconds) on an input this size; a generous bound still catches
    // a regression without being a flaky timing assertion.
    expect(elapsedMs).toBeLessThan(200);
  });
});
