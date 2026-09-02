// T020: read-only vs. mutating classification (FR-003, FR-007; research.md #7).
//
// Classification lives entirely in the core and is encoded in the language-neutral
// manifest, so it cannot drift by target language — the mechanism that makes
// Constitution Principle VI enforceable for this requirement.

export interface Classification {
  mutating: boolean;
  /** true when the generator judges a mutating action to be destructive (delete-like). */
  destructive: boolean;
  /** true when repeating the call has the same effect (drives retry gating). */
  idempotent: boolean;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** PUT/DELETE are mutating but idempotent; POST/PATCH are mutating and non-idempotent. */
const IDEMPOTENT_MUTATING = new Set(["PUT", "DELETE"]);
const DESTRUCTIVE_METHODS = new Set(["DELETE"]);
const DESTRUCTIVE_HINT_WORDS = /\b(delete|remove|destroy|purge|drop|wipe)\b/i;

/** Classify an API endpoint by HTTP method and a name/description hint. */
export function classifyApiEndpoint(httpMethod: string | null, hint = ""): Classification {
  const method = (httpMethod ?? "GET").toUpperCase();
  if (READ_METHODS.has(method)) {
    return { mutating: false, destructive: false, idempotent: true };
  }
  const idempotent = IDEMPOTENT_MUTATING.has(method);
  const destructive = DESTRUCTIVE_METHODS.has(method) || DESTRUCTIVE_HINT_WORDS.test(hint);
  return { mutating: true, destructive, idempotent };
}

/** Classify a pure UI action (forms/buttons). A submit that isn't clearly a search is mutating. */
export function classifyUiAction(label: string, method = "POST"): Classification {
  const m = method.toUpperCase();
  if (READ_METHODS.has(m) || /\b(search|filter|find|view|list|show)\b/i.test(label)) {
    return { mutating: false, destructive: false, idempotent: true };
  }
  const destructive = DESTRUCTIVE_HINT_WORDS.test(label);
  return { mutating: true, destructive, idempotent: false };
}
