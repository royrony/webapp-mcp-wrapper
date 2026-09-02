// T021: identity-key normalization for dedup and diffing (FR-004; research.md #6).
//
// The identity key must be stable across re-runs so the refresh diff (US4) can tell
// "same endpoint" from "new/removed endpoint". Numeric and UUID path segments are
// collapsed into templates so /widgets/1 and /widgets/2 share one key.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Collapse a URL path into a template, replacing id-like segments with `{id}`. */
export function templatizePath(pathname: string): string {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  const templated = segments.map((seg) => {
    if (/^\d+$/.test(seg)) return "{id}";
    if (UUID_RE.test(seg)) return "{id}";
    // long hex / opaque tokens
    if (/^[0-9a-f]{16,}$/i.test(seg)) return "{id}";
    return seg;
  });
  return "/" + templated.join("/");
}

/** Identity key for an API endpoint: METHOD + templated path. */
export function apiIdentityKey(httpMethod: string | null, url: string): string {
  const method = (httpMethod ?? "GET").toUpperCase();
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  return `${method} ${templatizePath(pathname)}`;
}

/** Identity key for a pure UI action: role + normalized label. */
export function uiIdentityKey(role: string, label: string): string {
  const normalizedLabel = label.trim().toLowerCase().replace(/\s+/g, "-");
  return `ui:${role.toLowerCase()}:${normalizedLabel}`;
}
