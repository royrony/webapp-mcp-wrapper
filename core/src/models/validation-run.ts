// T016: ValidationRun — matches contracts/validation-run.schema.json.

export interface ToolResult {
  toolName: string;
  invoked: boolean;
  success: boolean;
  error?: string;
}

export interface RemediationAttempt {
  issue: string;
  action: string;
  outcome: string;
}

export interface ValidationRun {
  packageId: string;
  startedAt: string;
  finishedAt: string;
  /** One entry per in-scope tool; never a tool excluded by the user's scope (FR-022). */
  toolResults: ToolResult[];
  authFlowExercised: boolean;
  retryBehaviorVerified: boolean;
  /** At most one entry per failed item, per FR-023's automatic-retry floor. */
  remediationAttempts: RemediationAttempt[];
  overallStatus: "ready" | "failed";
}
