import { describe, expect, it } from "bun:test";

import { Projection, projector, subsumes } from "../src/index.js";

describe("projection lattice", () => {
  it("orders OPAQUE < SUMMARY < TRANSPARENT", () => {
    expect(Projection.OPAQUE < Projection.SUMMARY).toBe(true);
    expect(Projection.SUMMARY < Projection.TRANSPARENT).toBe(true);
  });

  it("subsumes: downgrade is free", () => {
    expect(subsumes(Projection.TRANSPARENT, Projection.SUMMARY)).toBe(true);
    expect(subsumes(Projection.SUMMARY, Projection.OPAQUE)).toBe(true);
    expect(subsumes(Projection.OPAQUE, Projection.OPAQUE)).toBe(true);
  });

  it("subsumes: no upgrade", () => {
    expect(subsumes(Projection.OPAQUE, Projection.SUMMARY)).toBe(false);
    expect(subsumes(Projection.SUMMARY, Projection.TRANSPARENT)).toBe(false);
  });

  it("projector never exposes string contents", () => {
    const secret = "https://example.io/leads/abc123?token=supersecret";
    const summary = projector.project(secret);
    expect(summary).toEqual({ kind: "str", len: secret.length });
    const blob = JSON.stringify(summary);
    expect(blob).not.toContain("example.io");
    expect(blob).not.toContain("supersecret");
  });

  it("list summary is count and item kind", () => {
    const summary = projector.project([1, 2, 3]);
    expect(summary.kind).toBe("list");
    expect(summary.count).toBe(3);
    expect(summary.first_item_kind).toBe("int");
  });

  it("bounds a misbehaving custom projector", () => {
    projector.register("Leaky", (v) => ({ everything: v }));
    const huge = "x".repeat(10_000);
    const out = projector.project(huge, "Leaky");
    expect((out.everything as string).length).toBeLessThanOrEqual(64);
  });
});
