import type { GenerateInput } from "./types.ts";

export const SYSTEM_PROMPT = `You are a senior TypeScript engineer evaluating @tailor-platform/sdk.
Write the requested code as a single TypeScript code block.
Include imports. Do not include scaffolding around the code (no test runner, no markdown commentary).
If you have to guess at an API, mark the guess with a "// GUESS: <reason>" comment on the line above.`;

export function buildUserPrompt(input: GenerateInput): string {
  const parts: string[] = [];
  if (input.docsContext) {
    parts.push("# Reference (use only what is shown — do not assume other APIs)");
    parts.push(input.docsContext);
    parts.push("");
  } else {
    parts.push("# No SDK reference is provided.");
    parts.push(
      "Write what you would expect the @tailor-platform/sdk API to look like, based on your prior knowledge.",
    );
    parts.push("");
  }
  parts.push("# Task");
  parts.push(input.prompt);
  return parts.join("\n");
}
