import { describe, it, expect } from "vitest";
import { classifyApiEndpoint, classifyUiAction } from "../../src/extractor/classify.js";

describe("classify", () => {
  it("treats GET/HEAD as read-only idempotent", () => {
    expect(classifyApiEndpoint("GET")).toEqual({
      mutating: false,
      destructive: false,
      idempotent: true,
    });
  });

  it("treats POST as mutating non-idempotent", () => {
    expect(classifyApiEndpoint("POST")).toEqual({
      mutating: true,
      destructive: false,
      idempotent: false,
    });
  });

  it("treats PUT/DELETE as mutating idempotent; DELETE destructive", () => {
    expect(classifyApiEndpoint("PUT").idempotent).toBe(true);
    expect(classifyApiEndpoint("DELETE")).toEqual({
      mutating: true,
      destructive: true,
      idempotent: true,
    });
  });

  it("flags destructive by hint word", () => {
    expect(classifyApiEndpoint("POST", "remove account").destructive).toBe(true);
  });

  it("classifies search-like ui actions as read-only", () => {
    expect(classifyUiAction("Search results").mutating).toBe(false);
    expect(classifyUiAction("Create widget").mutating).toBe(true);
  });
});
