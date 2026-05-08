import { runCli } from "./cli-utils.ts";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.ts";
import type { GenerateInput, GenerateOutput, Provider } from "./types.ts";

export type GeminiCliOptions = {
  binary?: string;
  model?: string;
  timeoutMs?: number;
};

/**
 * Provider that drives the local `gemini` CLI in one-shot mode. Auth comes
 * from the user's existing `gemini` login, so GEMINI_API_KEY is not required.
 *
 * Gemini's CLI has no system-prompt flag, so SYSTEM_PROMPT is prepended to the
 * user prompt and piped via stdin.
 */
export class GeminiCliProvider implements Provider {
  readonly id: string;
  private binary: string;
  private model: string;
  private timeoutMs: number;

  constructor(opts: GeminiCliOptions = {}) {
    this.binary = opts.binary ?? "gemini";
    this.model = opts.model ?? "gemini-2.5-pro";
    this.timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    this.id = `gemini-cli:${this.model}`;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const args = [
      "-m",
      this.model,
      "--output-format",
      "text",
      // Avoid blocking on tool-use approvals in non-interactive mode.
      "--yolo",
    ];
    const stdin = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(input)}\n`;
    const result = await runCli({
      command: this.binary,
      args,
      stdin,
      timeoutMs: this.timeoutMs,
    });
    if (result.exitCode !== 0) {
      throw new Error(`gemini CLI exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
    }
    return {
      rawResponse: result.stdout,
      tokens: { in: 0, out: 0 },
    };
  }
}
