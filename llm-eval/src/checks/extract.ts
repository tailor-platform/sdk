import type { CheckName, Signal } from "../types.ts";
import type { Inventory } from "../variants/inventory.ts";
import { computeVibeDistance } from "./ast-distance.ts";
import { extractCodeBlock } from "./extract-code.ts";
import { checkHallucinations } from "./halluc.ts";
import { checkImports } from "./imports.ts";
import { parseCode } from "./parse.ts";
import { checkPatterns, checkPreamble } from "./patterns.ts";
import { typecheckCode } from "./typecheck.ts";

export type ExtractInput = {
  rawResponse: string;
  cellId: string;
  variantDist: string;
  inventory: Inventory;
  checks: CheckName[];
};

export type ExtractOutput = {
  code: string;
  signals: Signal[];
  vibe?: { distance: number; invented: string[]; matched: string[] };
};

export async function extractSignals(input: ExtractInput): Promise<ExtractOutput> {
  const { code, preambleChars } = extractCodeBlock(input.rawResponse);
  const signals: Signal[] = [];

  if (preambleChars > 600) {
    signals.push(...checkPreamble(input.rawResponse));
  }

  const parsed = parseCode(code, `${input.cellId}.ts`);

  for (const g of parsed.guessComments) {
    signals.push({ type: "guess_comment", line: g.line, text: g.text });
  }

  const checkSet = new Set(input.checks);

  if (checkSet.has("imports")) {
    signals.push(...checkImports(parsed.imports, input.inventory));
  }
  if (checkSet.has("halluc")) {
    signals.push(...checkHallucinations(parsed.calls, parsed.imports, input.inventory));
  }
  if (checkSet.has("patterns")) {
    signals.push(...checkPatterns(parsed.calls));
  }
  if (checkSet.has("typecheck")) {
    signals.push(...(await typecheckCode(code, input.cellId, input.variantDist)));
  }

  let vibe: ExtractOutput["vibe"];
  if (checkSet.has("ast-distance")) {
    const v = computeVibeDistance(code, input.inventory);
    vibe = { distance: v.distance, invented: v.details.invented, matched: v.details.matched };
  }

  return { code, signals, vibe };
}
