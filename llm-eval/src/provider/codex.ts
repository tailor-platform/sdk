import OpenAI from "openai";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.ts";
import type { GenerateInput, GenerateOutput, Provider } from "./types.ts";

export type CodexOptions = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

export class CodexProvider implements Provider {
  readonly id: string;
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(opts: CodexOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");
    this.client = new OpenAI({ apiKey });
    this.model = opts.model ?? "gpt-5-codex";
    this.maxTokens = opts.maxTokens ?? 4096;
    this.id = `codex:${this.model}`;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      max_tokens: input.maxOutputTokens ?? this.maxTokens,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    });
    const rawResponse = completion.choices[0]?.message.content ?? "";
    return {
      rawResponse,
      tokens: {
        in: completion.usage?.prompt_tokens ?? 0,
        out: completion.usage?.completion_tokens ?? 0,
      },
    };
  }
}
