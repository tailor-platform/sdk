import { buildUserPrompt } from "./prompt.ts";
import type { GenerateInput, GenerateOutput, Provider } from "./types.ts";

/**
 * Test-only provider that lets a unit test inject canned responses keyed
 * by a probe id substring. Useful for offline smoke tests.
 */
export class MockProvider implements Provider {
  readonly id: string;
  private byKey: Map<string, string>;
  private fallback: string;

  constructor(opts: { id?: string; responses?: Record<string, string>; fallback?: string } = {}) {
    this.id = opts.id ?? "mock";
    this.byKey = new Map(Object.entries(opts.responses ?? {}));
    this.fallback = opts.fallback ?? "```ts\n// no canned response\n```";
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const promptText = buildUserPrompt(input);
    let chosen = this.fallback;
    for (const [needle, response] of this.byKey) {
      if (promptText.includes(needle)) {
        chosen = response;
        break;
      }
    }
    return {
      rawResponse: chosen,
      tokens: { in: promptText.length / 4, out: chosen.length / 4 },
    };
  }
}
