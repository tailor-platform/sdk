import Anthropic from "@anthropic-ai/sdk";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.ts";
import type { GenerateInput, GenerateOutput, Provider } from "./types.ts";

export type ClaudeOptions = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

export class ClaudeProvider implements Provider {
  readonly id: string;
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(opts: ClaudeOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    this.client = new Anthropic({ apiKey });
    this.model = opts.model ?? "claude-opus-4-7";
    this.maxTokens = opts.maxTokens ?? 4096;
    this.id = `claude:${this.model}`;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: input.maxOutputTokens ?? this.maxTokens,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    });

    const rawResponse = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      rawResponse,
      tokens: {
        in: message.usage.input_tokens,
        out: message.usage.output_tokens,
      },
    };
  }
}
