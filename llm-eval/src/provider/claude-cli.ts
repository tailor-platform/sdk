import { runCli } from "./cli-utils.ts";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.ts";
import type { GenerateInput, GenerateOutput, Provider } from "./types.ts";

export type ClaudeCliOptions = {
  /** CLI binary; defaults to `claude`. Override for non-PATH installs. */
  binary?: string;
  /** Model alias or full ID (e.g. `opus`, `sonnet`, `claude-opus-4-7`). */
  model?: string;
  /** Hard timeout in ms; defaults to 5 min. */
  timeoutMs?: number;
};

/**
 * Provider that drives the local `claude` CLI in non-interactive mode (-p).
 * Auth flows through whatever the user set up locally (OAuth/keychain or API key),
 * so this works without exporting ANTHROPIC_API_KEY.
 *
 * To keep the prompt deterministic across users, we run in a fresh tmpdir so
 * project CLAUDE.md files don't leak in, and we disable slash commands and
 * session persistence.
 */
export class ClaudeCliProvider implements Provider {
  readonly id: string;
  private binary: string;
  private model: string;
  private timeoutMs: number;

  constructor(opts: ClaudeCliOptions = {}) {
    this.binary = opts.binary ?? "claude";
    // Default to sonnet: opus has tight rate limits that bite during batch
    // matrix runs. Opt into opus explicitly via `claude:claude-opus-4-7`.
    this.model = opts.model ?? "claude-sonnet-4-6";
    this.timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    this.id = `claude-cli:${this.model}`;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const args = [
      "-p",
      "--output-format",
      "text",
      "--model",
      this.model,
      "--system-prompt",
      SYSTEM_PROMPT,
      "--no-session-persistence",
      "--disable-slash-commands",
      "--exclude-dynamic-system-prompt-sections",
      "--setting-sources",
      "user",
    ];
    const result = await runCli({
      command: this.binary,
      args,
      stdin: buildUserPrompt(input),
      timeoutMs: this.timeoutMs,
    });
    if (result.exitCode !== 0) {
      throw new Error(`claude CLI exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
    }
    return {
      rawResponse: result.stdout,
      tokens: { in: 0, out: 0 },
    };
  }
}
