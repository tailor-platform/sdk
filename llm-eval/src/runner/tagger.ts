import type { Cell } from "../types.ts";
import type { RunCellOutput } from "./cell.ts";

const PRESET_ORDER: Cell["condition"]["preset"][] = [
  "bare",
  "jsdoc",
  "docsOnly",
  "skillsOnly",
  "inPackage",
  "full",
];

const PRESET_GATE_LAYER: Record<
  Exclude<Cell["condition"]["preset"], "predicted" | "bare">,
  "L2" | "L3" | "L4" | "L6"
> = {
  jsdoc: "L2",
  docsOnly: "L3",
  skillsOnly: "L4",
  inPackage: "L4",
  full: "L6",
};

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of items) {
    const k = key(t);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(t);
  }
  return out;
}

/**
 * Annotate cells with OK / CUTOFF / DESIGN / IMPROVED_BY_VARIANT / VIBE_GAP_HIGH tags.
 */
export function tagAll(cells: RunCellOutput[]): void {
  // OK / CUTOFF: per (probe, model, variant, repeat) walk presets bare→jsdoc→inPackage→full
  const groups = groupBy(cells, (c) => `${c.probe}|${c.model}|${c.variant}|${c.repeatIndex}`);
  for (const group of groups.values()) {
    const byPreset = new Map<string, RunCellOutput>();
    for (const c of group) byPreset.set(c.condition.preset, c);

    let firstPassPreset: Cell["condition"]["preset"] | null = null;
    for (const preset of PRESET_ORDER) {
      const cell = byPreset.get(preset);
      if (!cell) continue;
      if (cell.passed) {
        firstPassPreset = preset;
        break;
      }
    }

    if (firstPassPreset) {
      for (const preset of PRESET_ORDER) {
        const cell = byPreset.get(preset);
        if (!cell) continue;
        if (preset === firstPassPreset) {
          if (preset === "bare") {
            cell.tags.push({ kind: "OK" });
          } else {
            const gate = PRESET_GATE_LAYER[preset as keyof typeof PRESET_GATE_LAYER];
            cell.tags.push({ kind: "CUTOFF", gateLayer: gate });
          }
        }
      }
    }
  }

  // DESIGN: cross-model agreement at the (probe, condition, variant, repeat) level.
  // strength = number of models that all hit the same hallucinated symbol.
  const designGroups = groupBy(
    cells,
    (c) => `${c.probe}|${c.condition.preset}|${c.variant}|${c.repeatIndex}`,
  );
  for (const group of designGroups.values()) {
    const modelSet = new Set(group.map((c) => c.model));
    if (modelSet.size < 2) continue;
    const symCounts = new Map<string, Set<string>>();
    for (const cell of group) {
      for (const sig of cell.signals) {
        const key = signalKey(sig);
        if (!key) continue;
        if (!symCounts.has(key)) symCounts.set(key, new Set());
        symCounts.get(key)!.add(cell.model);
      }
    }
    const designStrength = [...symCounts.values()].reduce(
      (max, models) => Math.max(max, models.size),
      0,
    );
    if (designStrength >= 2) {
      for (const cell of group) {
        cell.tags.push({ kind: "DESIGN", strength: designStrength });
      }
    }
  }

  // IMPROVED_BY_VARIANT: within (probe, model, condition, repeat), compare variants.
  const variantGroups = groupBy(
    cells,
    (c) => `${c.probe}|${c.model}|${c.condition.preset}|${c.repeatIndex}`,
  );
  for (const group of variantGroups.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => a.signals.length - b.signals.length);
    const best = ranked[0];
    for (const cell of group) {
      if (cell.variant !== best.variant && cell.signals.length > best.signals.length) {
        cell.tags.push({
          kind: "IMPROVED_BY_VARIANT",
          variant: best.variant,
          deltaSignals: cell.signals.length - best.signals.length,
        });
      }
    }
  }

  // VIBE_GAP_HIGH: from `predicted` cells where vibe distance is high.
  for (const cell of cells) {
    if (cell.condition.preset !== "predicted") continue;
    if (!cell.vibe) continue;
    if (cell.vibe.distance >= 0.5) {
      cell.tags.push({ kind: "VIBE_GAP_HIGH", astDistance: cell.vibe.distance });
    }
  }
}

function signalKey(sig: Cell["signals"][number]): string | null {
  switch (sig.type) {
    case "hallucinated_import":
      return `hallucinated_import:${sig.path}/${sig.symbol}`;
    case "hallucinated_method":
      return `hallucinated_method:${sig.receiver}.${sig.method}`;
    case "wrong_import_path":
      return `wrong_import_path:${sig.path}`;
    case "invented_factory":
      return `invented_factory:${sig.symbol}`;
    case "parameter_order_swap":
    case "forgotten_await":
    case "positional_for_options":
    case "wrong_overload":
      return `${sig.type}:${sig.call}`;
    default:
      return null;
  }
}
