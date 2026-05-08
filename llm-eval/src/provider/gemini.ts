import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.ts";
import type { GenerateInput, GenerateOutput, Provider } from "./types.ts";

export type GeminiOptions = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
};

export class GeminiProvider implements Provider {
  readonly id: string;
  private client: GoogleGenerativeAI;
  private model: string;
  private maxTokens: number;

  constructor(opts: GeminiOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) not set");
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = opts.model ?? "gemini-2.5-pro";
    this.maxTokens = opts.maxTokens ?? 4096;
    this.id = `gemini:${this.model}`;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: input.maxOutputTokens ?? this.maxTokens,
      },
    });
    const result = await model.generateContent(buildUserPrompt(input));
    const rawResponse = result.response.text();
    const usage = result.response.usageMetadata;
    return {
      rawResponse,
      tokens: {
        in: usage?.promptTokenCount ?? 0,
        out: usage?.candidatesTokenCount ?? 0,
      },
    };
  }
}
