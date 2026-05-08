import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunCellOutput } from "../runner/cell.ts";
import type { Signal } from "../types.ts";

type Hit = {
  key: string;
  signalDescription: string;
  models: Set<string>;
  probes: Set<string>;
};

function describeSignal(sig: Signal): { key: string; desc: string } | null {
  switch (sig.type) {
    case "hallucinated_method":
      return {
        key: `m:${sig.receiver}.${sig.method}`,
        desc: `hallucinated method \`${sig.receiver}.${sig.method}\``,
      };
    case "hallucinated_import":
      return {
        key: `i:${sig.symbol}`,
        desc: `hallucinated import \`${sig.symbol}\` from ${sig.path}`,
      };
    case "wrong_import_path":
      return { key: `p:${sig.path}`, desc: `wrong import path \`${sig.path}\`` };
    case "forgotten_await":
      return { key: `a:${sig.call}`, desc: `forgotten await on \`${sig.call}\`` };
    case "positional_for_options":
      return {
        key: `o:${sig.call}`,
        desc: `positional args where options object expected: \`${sig.call}\``,
      };
    default:
      return null;
  }
}

export function renderDesignBacklog(cells: RunCellOutput[]): string {
  const hits = new Map<string, Hit>();
  for (const cell of cells) {
    if (cell.condition.preset === "predicted") continue; // design = with-docs runs
    for (const sig of cell.signals) {
      const d = describeSignal(sig);
      if (!d) continue;
      const existing = hits.get(d.key);
      if (existing) {
        existing.models.add(cell.model);
        existing.probes.add(cell.probe);
      } else {
        hits.set(d.key, {
          key: d.key,
          signalDescription: d.desc,
          models: new Set([cell.model]),
          probes: new Set([cell.probe]),
        });
      }
    }
  }
  const ranked = [...hits.values()].sort((a, b) => b.models.size - a.models.size);
  const lines: string[] = ["# Design Backlog\n"];
  if (ranked.length === 0) {
    lines.push("(no design signals.)\n");
    return lines.join("\n");
  }
  for (const hit of ranked) {
    lines.push(`## strength ${hit.models.size}/N — ${hit.signalDescription}`);
    lines.push(`- models: ${[...hit.models].join(", ")}`);
    lines.push(`- probes: ${[...hit.probes].join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function writeDesignBacklog(filePath: string, cells: RunCellOutput[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, renderDesignBacklog(cells), "utf8");
}
