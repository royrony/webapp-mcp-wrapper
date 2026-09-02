// T014: GeneratedMCPServerPackage manifest — matches contracts/package-manifest.schema.json.

export type TargetLanguage = "node" | "python" | "java";
export type DeploymentMode = "stdio" | "streamable-http";

export interface RetryPolicy {
  /** Contract fixes this at exactly 3. */
  maxAttempts: 3;
  backoff: "exponential-jitter";
}

export interface RuntimePolicy {
  retry: RetryPolicy;
  logging: { structured: true };
}

export interface PackageManifest {
  webappTargetId: string;
  sourceRunId: string;
  /** Selected per FR-018; determines which peer runtime serve/validate dispatch to. */
  targetLanguage: TargetLanguage;
  /** Pinned runtime library version, recorded for Constitution Principle VII traceability. */
  runtimeVersion: string;
  /** MUST always contain both values — deployment mode is a serve-time choice (FR-015). */
  deploymentModes: DeploymentMode[];
  runtimePolicy: RuntimePolicy;
}

/** Pinned runtime library versions per language (Principle VII traceability). */
export const RUNTIME_VERSIONS: Record<TargetLanguage, string> = {
  node: "0.1.0",
  python: "0.1.0",
  java: "0.1.0",
};

/** The single shared runtime policy — identical across languages by construction (Principle VI). */
export const SHARED_RUNTIME_POLICY: RuntimePolicy = {
  retry: { maxAttempts: 3, backoff: "exponential-jitter" },
  logging: { structured: true },
};
