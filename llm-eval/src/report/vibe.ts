import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunCellOutput } from "../runner/cell.ts";

export function renderVibeMap(cells: RunCellOutput[]): string {
  const predicted = cells.filter((c) => c.condition.preset === "predicted" && c.vibe);
  if (predicted.length === 0) {
    return "# Vibe Map\n\n(no `predicted` cells with vibe data.)\n";
  }

  const symbolDistance = new Map<string, Map<string, number[]>>();
  for (const cell of predicted) {
    const surface = [...new Set([...cell.vibe!.invented, ...cell.vibe!.matched])];
    for (const sym of surface) {
      const isInvented = cell.vibe!.invented.includes(sym);
      const distance = isInvented ? 1 : 0;
      if (!symbolDistance.has(sym)) symbolDistance.set(sym, new Map());
      const byModel = symbolDistance.get(sym)!;
      if (!byModel.has(cell.model)) byModel.set(cell.model, []);
      byModel.get(cell.model)!.push(distance);
    }
  }

  const models = [...new Set(predicted.map((c) => c.model))].sort();
  const lines: string[] = ["# Vibe Map (predicted-only)\n"];
  lines.push(`| symbol | ${models.join(" | ")} | mean |`);
  lines.push(`| --- | ${models.map(() => "---").join(" | ")} | --- |`);

  const rows: { symbol: string; values: number[]; mean: number }[] = [];
  for (const [symbol, byModel] of symbolDistance) {
    const values: number[] = [];
    for (const m of models) {
      const arr = byModel.get(m);
      const avg = arr && arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;
      values.push(avg);
    }
    const present = values.filter((v) => !Number.isNaN(v));
    const mean = present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : NaN;
    rows.push({ symbol, values, mean });
  }

  rows.sort((a, b) => b.mean - a.mean);
  for (const row of rows) {
    const cells = row.values.map((v) => (Number.isNaN(v) ? "—" : v.toFixed(2)));
    const flag = row.mean >= 0.5 ? " ← VIBE_GAP_HIGH" : "";
    lines.push(`| \`${row.symbol}\` | ${cells.join(" | ")} | ${row.mean.toFixed(2)}${flag} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function writeVibeMap(filePath: string, cells: RunCellOutput[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, renderVibeMap(cells), "utf8");
}
