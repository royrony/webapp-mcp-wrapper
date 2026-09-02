// T043: the Skill's one-automatic-remediation-and-retest support (FR-023).
//
// The Skill (agent) decides *what* to change; this module provides the deterministic
// "apply a fix, regenerate, re-validate exactly once" mechanism so the retry is bounded
// and scriptable rather than an open-ended agent loop.

import type { ValidationRun } from "../models/validation-run.js";
import { generateCommand, type GenerateOptions } from "../cli/generate.js";
import { validateCommand, type ValidateOptions } from "../cli/validate.js";

export interface RemediationPlan {
  /** How the agent proposes to fix the failing package (for the audit trail). */
  issue: string;
  action: string;
  /** Re-generate with these options before re-validating. */
  regenerate: { rootUrl: string; options: GenerateOptions };
  /** Re-validate this package dir. */
  revalidate: { packageDir: string; options?: ValidateOptions };
}

export interface RemediationResult {
  attempted: boolean;
  finalRun: ValidationRun | null;
  outcome: "resolved" | "unresolved" | "not-needed";
  note: string;
}

/** Run exactly one remediation-and-retest cycle. Returns the post-fix validation outcome.
 * Callers MUST NOT call this in a loop — FR-023's floor is "at least one", the ceiling is one
 * automatic cycle before reporting an unresolved issue to the user. */
export async function remediateOnce(
  currentRun: ValidationRun,
  plan: RemediationPlan,
  deps: {
    generate?: typeof generateCommand;
    validate?: typeof validateCommand;
    readValidation: (packageDir: string) => Promise<ValidationRun>;
  },
): Promise<RemediationResult> {
  if (currentRun.overallStatus === "ready") {
    return { attempted: false, finalRun: currentRun, outcome: "not-needed", note: "already ready" };
  }

  const generate = deps.generate ?? generateCommand;
  const validate = deps.validate ?? validateCommand;

  await generate(plan.regenerate.rootUrl, plan.regenerate.options);
  const code = await validate(plan.revalidate.packageDir, plan.revalidate.options ?? {});
  const finalRun = await deps.readValidation(plan.revalidate.packageDir);

  // Record the single remediation attempt on the final run for the audit trail.
  finalRun.remediationAttempts = [
    ...finalRun.remediationAttempts,
    {
      issue: plan.issue,
      action: plan.action,
      outcome: finalRun.overallStatus === "ready" ? "resolved after retest" : "still failing after retest",
    },
  ];

  return {
    attempted: true,
    finalRun,
    outcome: code === 0 && finalRun.overallStatus === "ready" ? "resolved" : "unresolved",
    note:
      finalRun.overallStatus === "ready"
        ? "one remediation cycle resolved the failure"
        : "one remediation cycle did not resolve the failure; reporting to user",
  };
}
