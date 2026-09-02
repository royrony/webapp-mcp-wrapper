// Exit-code conventions shared across all CLI commands (contracts/cli-commands.md).
export const EXIT = {
  SUCCESS: 0,
  UNREACHABLE_URL: 1, // extract: FR-009
  INVALID_ARGS: 2,
  NO_EXTRACTION_RUN: 3, // apply-overrides / generate
  OVERRIDES_SCHEMA_INVALID: 4, // apply-overrides
  UNSUPPORTED_LANG: 5, // generate
  VALIDATION_FAILED: 6, // validate: overallStatus === "failed"
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Thrown by command handlers to signal a specific exit code with a message. */
export class CliError extends Error {
  constructor(
    public readonly code: ExitCode,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}
