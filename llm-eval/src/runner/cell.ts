import { buildDocsContext } from "../conditions/builder.ts";
import { extractSignals } from "../checks/extract.ts";
import type { Cell, DocsCondition, Probe } from "../types.ts";
import { resolveVariantPath } from "../variants/resolve.ts";
import type { Inventory } from "../variants/inventory.ts";
import type { Provider } from "../provider/types.ts";

type PredictedCacheEntry = { rawResponse: string; tokens: { in: number; out: number } };

export type RunCellInput = {
  probe: Probe;
  provider: Provider;
  condition: DocsCondition;
  variant: string;
  repeatIndex: number;
  inventory: Inventory;
  /**
   * Shared cache of `predicted`-mode generations keyed by probe+provider+repeat.
   * The predicted prompt is variant-independent (no docs); reusing the response
   * across variants avoids duplicate LLM calls while still letting each variant
   * recompute its own vibe distance against its own inventory. Different repeats
   * intentionally do NOT share — we want to observe LLM non-determinism.
   */
  predictedCache?: Map<string, Promise<PredictedCacheEntry>>;
};

export type RunCellOutput = Cell & {
  vibe?: { distance: number; invented: string[]; matched: string[] };
  /** Set when the cell failed to run (e.g. provider error). */
  error?: string;
};

export function cellId(
  probeId: string,
  model: string,
  condition: DocsCondition,
  variant: string,
  repeatIndex: number,
): string {
  const suffix = repeatIndex > 0 ? `__r${repeatIndex}` : "";
  return `${probeId}__${model}__${condition.preset}__${variant}${suffix}`;
}

export async function runCell(input: RunCellInput): Promise<RunCellOutput> {
  const start = performance.now();
  const variantDist = resolveVariantPath(input.variant);
  const ctx = await buildDocsContext(input.condition, variantDist);

  let generation: PredictedCacheEntry;
  if (input.condition.preset === "predicted" && input.predictedCache) {
    const key = `${input.probe.id}__${input.provider.id}`;
    let pending = input.predictedCache.get(key);
    if (!pending) {
      pending = input.provider
        .generate({
          prompt: input.probe.prompt,
          docsContext: ctx.text,
          sdkPath: variantDist,
        })
        .then((g) => ({ rawResponse: g.rawResponse, tokens: g.tokens }));
      input.predictedCache.set(key, pending);
    }
    generation = await pending;
  } else {
    generation = await input.provider.generate({
      prompt: input.probe.prompt,
      docsContext: ctx.text,
      sdkPath: variantDist,
    });
  }

  const id = cellId(
    input.probe.id,
    input.provider.id,
    input.condition,
    input.variant,
    input.repeatIndex,
  );
  const extracted = await extractSignals({
    rawResponse: generation.rawResponse,
    cellId: id,
    variantDist,
    inventory: input.inventory,
    checks: input.probe.checks,
  });

  const passed = extracted.signals.length === 0;
  const durationMs = Math.round(performance.now() - start);

  return {
    probe: input.probe.id,
    model: input.provider.id,
    condition: input.condition,
    variant: input.variant,
    repeatIndex: input.repeatIndex,
    generatedCode: extracted.code,
    rawResponse: generation.rawResponse,
    signals: extracted.signals,
    passed,
    tags: [],
    tokens: generation.tokens,
    durationMs,
    vibe: extracted.vibe,
  };
}
