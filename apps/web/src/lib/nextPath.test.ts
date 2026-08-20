import { describe, expect, it } from "vitest";
import { safeNextPath } from "./nextPath";

describe("safeNextPath", () => {
  it("keeps a same-site path", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/churches/st-marys-corning/")).toBe(
      "/churches/st-marys-corning/",
    );
    expect(safeNextPath("/?eventType=mass&day=sunday")).toBe(
      "/?eventType=mass&day=sunday",
    );
  });

  it("falls back when nothing usable was supplied", () => {
    expect(safeNextPath(null)).toBe("/account");
    expect(safeNextPath(undefined)).toBe("/account");
    expect(safeNextPath("")).toBe("/account");
    expect(safeNextPath("   ")).toBe("/account");
  });

  it("honours a caller-supplied fallback", () => {
    expect(safeNextPath(null, "/")).toBe("/");
  });

  it("refuses anything that points off site", () => {
    for (const value of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "\\\\evil.test",
      "javascript:alert(1)",
      "account",
      "/\nhttps://evil.test",
    ]) {
      expect(safeNextPath(value)).toBe("/account");
    }
  });
});
