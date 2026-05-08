import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunCellOutput } from "../runner/cell.ts";

export function renderCutoffBacklog(cells: RunCellOutput[]): string {
  const byLayer: Record<string, { probe: string; model: string; variant: string }[]> = {};
  for (const cell of cells) {
    for (const tag of cell.tags) {
      if (tag.kind !== "CUTOFF") continue;
      byLayer[tag.gateLayer] ??= [];
      byLayer[tag.gateLayer].push({
        probe: cell.probe,
        model: cell.model,
        variant: cell.variant,
      });
    }
  }

  const lines: string[] = ["# Cutoff Backlog\n"];
  if (Object.keys(byLayer).length === 0) {
    lines.push("(no cutoff signals — all probes either pass on `bare` or fail on `full`.)\n");
    return lines.join("\n");
  }
  const layers = Object.keys(byLayer).sort();
  for (const layer of layers) {
    lines.push(`## Gate layer: ${layer}\n`);
    for (const entry of byLayer[layer]) {
      lines.push(`- \`${entry.probe}\` — model=${entry.model}, variant=${entry.variant}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function writeCutoffBacklog(filePath: string, cells: RunCellOutput[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, renderCutoffBacklog(cells), "utf8");
}
