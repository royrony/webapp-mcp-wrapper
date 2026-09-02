// T012: MCPToolDefinition — matches contracts/mcp-tool-definition.schema.json.
// This is the entity that makes Constitution Principle VI enforceable: the exact
// same JSON is consumed unmodified by all three language runtimes.

export interface MCPToolAnnotations {
  /** true when the underlying functionality only reads data (FR-007). */
  readOnlyHint: boolean;
  /** true when invoking this tool can destructively change or remove data. */
  destructiveHint: boolean;
  /** true when repeating the call has the same effect; gates retry (research.md #5). */
  idempotentHint: boolean;
}

export interface MCPToolDefinition {
  /** Unique within the generated server; matches ^[a-zA-Z0-9_-]{1,128}$. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  annotations: MCPToolAnnotations;
  /** false for mutating tools unless the user opts in at generation time (FR-012). */
  includedByDefault: boolean;
  sourceIdentityKey: string;
  /** Absolute origin the tool's endpoint lives on (e.g. "https://api.example.com"). Optional;
   * when absent, the runtime dispatches against the webapp origin from the manifest. */
  baseUrl?: string;
}
