import { describe, expect, it } from "vitest";
import { isPolicyViolation, parseFunctionErrorPayload } from "./accountErrors";

describe("isPolicyViolation", () => {
  it("recognises a PostgREST insufficient_privilege error", () => {
    expect(isPolicyViolation({ code: "42501", message: "new row violates..." })).toBe(true);
  });

  it("ignores other database errors", () => {
    expect(isPolicyViolation({ code: "23505" })).toBe(false);
    expect(isPolicyViolation({ code: "23514" })).toBe(false);
  });

  it("copes with anything that is not an error object", () => {
    expect(isPolicyViolation(null)).toBe(false);
    expect(isPolicyViolation(undefined)).toBe(false);
    expect(isPolicyViolation("42501")).toBe(false);
    expect(isPolicyViolation({})).toBe(false);
  });
});

describe("parseFunctionErrorPayload", () => {
  it("reads the shape the edge functions return", () => {
    expect(
      parseFunctionErrorPayload({
        error: { code: "already_subscribed", message: "You already have one." },
      }),
    ).toEqual({ code: "already_subscribed", message: "You already have one." });
  });

  it("returns null for anything else, so the caller can fall back", () => {
    expect(parseFunctionErrorPayload(null)).toBeNull();
    expect(parseFunctionErrorPayload("boom")).toBeNull();
    expect(parseFunctionErrorPayload({})).toBeNull();
    expect(parseFunctionErrorPayload({ error: "boom" })).toBeNull();
    expect(parseFunctionErrorPayload({ error: { code: "x" } })).toBeNull();
    expect(parseFunctionErrorPayload({ error: { code: "", message: "m" } })).toBeNull();
    expect(parseFunctionErrorPayload({ error: { code: 500, message: "m" } })).toBeNull();
  });
});
