import { describe, it, expect } from "vitest";
import {
  templatizePath,
  apiIdentityKey,
  uiIdentityKey,
} from "../../src/extractor/identity-key.js";

describe("identity-key", () => {
  it("collapses numeric id segments into {id}", () => {
    expect(templatizePath("/widgets/1")).toBe("/widgets/{id}");
    expect(templatizePath("/widgets/42/detail")).toBe("/widgets/{id}/detail");
  });

  it("collapses uuid segments into {id}", () => {
    expect(templatizePath("/u/123e4567-e89b-12d3-a456-426614174000")).toBe("/u/{id}");
  });

  it("gives the same identity key across differing ids (stable for diffing)", () => {
    expect(apiIdentityKey("GET", "http://x/widgets/1")).toBe(
      apiIdentityKey("get", "http://x/widgets/2"),
    );
    expect(apiIdentityKey("GET", "http://x/widgets/1")).toBe("GET /widgets/{id}");
  });

  it("normalizes ui action labels", () => {
    expect(uiIdentityKey("button", "Create Widget")).toBe("ui:button:create-widget");
  });
});
