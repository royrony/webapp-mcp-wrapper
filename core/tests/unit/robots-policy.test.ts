import { describe, it, expect } from "vitest";
import {
  parseRobots,
  domainBoundaryOf,
  isWithinDomain,
  isDisallowed,
  mayCrawl,
} from "../../src/extractor/robots-policy.js";

describe("robots-policy", () => {
  const policy = parseRobots("User-agent: *\nDisallow: /admin\n");

  it("parses disallow rules for the wildcard user-agent", () => {
    expect(policy.disallow).toContain("/admin");
  });

  it("derives the registrable domain, dropping www", () => {
    expect(domainBoundaryOf("https://www.example.com/x")).toBe("example.com");
  });

  it("keeps subdomains within the boundary", () => {
    expect(isWithinDomain("https://api.example.com/x", "example.com")).toBe(true);
    expect(isWithinDomain("https://evil.com/x", "example.com")).toBe(false);
  });

  it("blocks disallowed paths", () => {
    expect(isDisallowed("/admin/users", policy)).toBe(true);
    expect(isDisallowed("/widgets", policy)).toBe(false);
  });

  it("mayCrawl combines domain + robots", () => {
    expect(mayCrawl("https://example.com/widgets", "example.com", policy)).toBe(true);
    expect(mayCrawl("https://example.com/admin", "example.com", policy)).toBe(false);
    expect(mayCrawl("https://evil.com/widgets", "example.com", policy)).toBe(false);
  });
});
