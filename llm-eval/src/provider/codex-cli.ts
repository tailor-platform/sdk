import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./cli-utils.ts";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.ts";
import type { GenerateInput, GenerateOutput, Provider } from "./types.ts";

export type CodexCliOptions = {
  binary?: string;
  /**
   * Model id passed to `codex exec --model`. Defaults to `gpt-5` to keep batch
   * matrix runs within OAuth quota; opt into `gpt-5-codex` explicitly via
   * `codex:gpt-5-codex` if you want the heavier model.
   */
  model?: string;
  timeoutMs?: number;
};

/**
 * Provider that drives the local `codex` CLI (`codex exec`) in non-interactive
 * mode. Reads auth from the user's existing codex login (no OPENAI_API_KEY needed).
 *
 * Codex has no separate system-prompt CLI flag, so SYSTEM_PROMPT is concatenated
 * into the user prompt. `--skip-git-repo-check` lets us run from a tmpdir,
 * `--ephemeral` keeps no session on disk.
 */
export class CodexCliProvider implements Provider {
  readonly id: string;
  private binary: string;
  private model: string;
  private timeoutMs: number;

  constructor(opts: CodexCliOptions = {}) {
    this.binary = opts.binary ?? "codex";
    this.model = opts.model ?? "gpt-5";
    this.timeoutMs = opts.timeoutMs ?? 5 * 60_000;
    this.id = `codex-cli:${this.model}`;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const dir = mkdtempSync(join(tmpdir(), "llm-eval-codex-"));
    const lastPath = join(dir, "last.txt");
    try {
      const args = [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--color",
        "never",
        "--model",
        this.model,
        "--output-last-message",
        lastPath,
        "-",
      ];
      const stdin = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(input)}\n`;
      const result = await runCli({
        command: this.binary,
        args,
        stdin,
        cwd: dir,
        timeoutMs: this.timeoutMs,
      });
      if (result.exitCode !== 0) {
        throw new Error(`codex CLI exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
      }
      let rawResponse: string;
      try {
        rawResponse = readFileSync(lastPath, "utf8");
      } catch {
        rawResponse = result.stdout;
      }
      return {
        rawResponse,
        tokens: { in: 0, out: 0 },
      };
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
