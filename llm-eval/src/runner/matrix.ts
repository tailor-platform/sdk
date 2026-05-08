import pLimit from "p-limit";
import type { DocsCondition, Probe } from "../types.ts";
import type { Provider } from "../provider/types.ts";
import { loadInventory, type Inventory } from "../variants/inventory.ts";
import { resolveVariantPath } from "../variants/resolve.ts";
import { runCell, type RunCellOutput } from "./cell.ts";
import { tagAll } from "./tagger.ts";

export type RunMatrixInput = {
  probes: Probe[];
  providers: Provider[];
  conditions: DocsCondition[];
  variants: string[];
  concurrency?: number;
  /** Number of times to repeat each (probe, model, condition, variant). Defaults to 1. */
  repeats?: number;
  /** Called when each cell finishes; useful for streaming progress. */
  onCell?: (cell: RunCellOutput) => void;
};

export type MatrixResult = {
  cells: RunCellOutput[];
};

export async function runMatrix(input: RunMatrixInput): Promise<MatrixResult> {
  const inventoryByVariant = new Map<string, Inventory>();
  for (const v of input.variants) {
    const dist = resolveVariantPath(v);
    inventoryByVariant.set(v, await loadInventory(dist));
  }

  const limit = pLimit(input.concurrency ?? 4);
  const repeats = Math.max(1, input.repeats ?? 1);
  const tasks: Promise<RunCellOutput>[] = [];

  // For `predicted`: the LLM call is variant-independent (no docs in the prompt),
  // so within a repeat we call once per (probe, provider) and reuse the rawResponse
  // across all variants. Different repeats DO call independently to capture
  // non-determinism. Cache key includes the repeat index.
  const predictedCache = new Map<
    string,
    Promise<{ rawResponse: string; tokens: { in: number; out: number } }>
  >();

  for (const probe of input.probes) {
    for (const provider of input.providers) {
      for (const condition of input.conditions) {
        for (const variant of input.variants) {
          for (let r = 0; r < repeats; r++) {
            const repeatIndex = r;
            tasks.push(
              limit(async () => {
                try {
                  const cell = await runCell({
                    probe,
                    provider,
                    condition,
                    variant,
                    repeatIndex,
                    inventory: inventoryByVariant.get(variant)!,
                    predictedCache: condition.preset === "predicted" ? predictedCache : undefined,
                  });
                  input.onCell?.(cell);
                  return cell;
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  const errored: RunCellOutput = {
                    probe: probe.id,
                    model: provider.id,
                    condition,
                    variant,
                    repeatIndex,
                    generatedCode: "",
                    rawResponse: "",
                    signals: [],
                    passed: false,
                    tags: [],
                    tokens: { in: 0, out: 0 },
                    durationMs: 0,
                    error: message.slice(0, 1000),
                  };
                  input.onCell?.(errored);
                  return errored;
                }
              }),
            );
          }
        }
      }
    }
  }

  const cells = await Promise.all(tasks);
  tagAll(cells);
  return { cells };
}
