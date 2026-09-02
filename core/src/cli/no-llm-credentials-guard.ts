// T044: startup guard that fails fast if any LLM/AI-provider API key is referenced by
// wrapper code/config (FR-024). The wrapper's intelligence comes entirely from whichever
// agent drives the Skill — the system itself must never hold LLM credentials.

const FORBIDDEN_ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "COHERE_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "HUGGINGFACE_API_KEY",
  "HF_TOKEN",
];

export class LlmCredentialError extends Error {
  constructor(key: string) {
    super(
      `Refusing to start: LLM/AI-provider credential "${key}" is present in the environment. ` +
        `The wrapper must not hold LLM credentials (FR-024). Unset it and drive the Skill from your agent instead.`,
    );
    this.name = "LlmCredentialError";
  }
}

/** Throws if any forbidden LLM credential env var is set (non-empty). */
export function assertNoLlmCredentials(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of FORBIDDEN_ENV_KEYS) {
    if (env[key] && String(env[key]).trim().length > 0) {
      throw new LlmCredentialError(key);
    }
  }
}

export const FORBIDDEN_LLM_ENV_KEYS = FORBIDDEN_ENV_KEYS;
