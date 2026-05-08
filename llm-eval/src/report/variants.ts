import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunCellOutput } from "../runner/cell.ts";

type GroupKey = string; // probe|model|preset
type VariantStats = {
  variant: string;
  repeats: number;
  errored: number;
  medianSignals: number;
  medianVibe?: number;
};
type Bucket = Map<string, VariantStats>; // variant -> stats

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Groups by (probe, model, preset, variant) and reduces over repeats.
 * Erroring repeats are excluded from the median; reported separately.
 */
function aggregate(cells: RunCellOutput[]): Map<GroupKey, Bucket> {
  type Acc = { signals: number[]; vibes: number[]; errored: number; total: number };
  const tmp = new Map<GroupKey, Map<string, Acc>>();
  for (const c of cells) {
    const k = `${c.probe}|${c.model}|${c.condition.preset}`;
    if (!tmp.has(k)) tmp.set(k, new Map());
    const inner = tmp.get(k)!;
    if (!inner.has(c.variant))
      inner.set(c.variant, { signals: [], vibes: [], errored: 0, total: 0 });
    const acc = inner.get(c.variant)!;
    acc.total++;
    if (c.error) {
      acc.errored++;
      continue;
    }
    acc.signals.push(c.signals.length);
    if (c.vibe) acc.vibes.push(c.vibe.distance);
  }

  const out = new Map<GroupKey, Bucket>();
  for (const [k, inner] of tmp) {
    const bucket: Bucket = new Map();
    for (const [variant, acc] of inner) {
      bucket.set(variant, {
        variant,
        repeats: acc.total,
        errored: acc.errored,
        medianSignals: median(acc.signals),
        medianVibe: acc.vibes.length > 0 ? median(acc.vibes) : undefined,
      });
    }
    out.set(k, bucket);
  }
  return out;
}

/**
 * Renders an A/B summary of every variant pair seen in the matrix.
 * For each (probe, model, preset) cell, signals and vibe are reduced over
 * repeats by median before delta is computed. Cells where every repeat
 * errored on either side are dropped.
 */
export function renderVariantsReport(cells: RunCellOutput[]): string {
  const variants = [...new Set(cells.map((c) => c.variant))].sort();
  if (variants.length < 2) {
    return "# Variants Report\n\n(only one variant in this run; nothing to compare.)\n";
  }

  const baseline = variants.includes("current") ? "current" : variants[0];
  const proposals = variants.filter((v) => v !== baseline);

  const repeats = Math.max(...cells.map((c) => c.repeatIndex)) + 1;
  const lines: string[] = [
    "# Variants Report",
    "",
    `Baseline: \`${baseline}\``,
    repeats > 1
      ? `Repeats: ${repeats} (signals/vibe shown as median across repeats)`
      : "Repeats: 1",
    "",
  ];

  const grouped = aggregate(cells);

  for (const proposal of proposals) {
    lines.push(`## ${proposal}  vs  ${baseline}`, "");
    const rows: Array<{
      probe: string;
      model: string;
      preset: string;
      sigBase: number;
      sigProp: number;
      vibeBase?: number;
      vibeProp?: number;
      errBase: number;
      errProp: number;
    }> = [];

    let totalSigDelta = 0;
    let totalVibeDelta = 0;
    let vibeRows = 0;

    for (const [k, bucket] of grouped) {
      const base = bucket.get(baseline);
      const prop = bucket.get(proposal);
      if (!base || !prop) continue;
      // Drop only if no successful repeats on either side.
      if (base.errored === base.repeats || prop.errored === prop.repeats) continue;
      const [probe, model, preset] = k.split("|");
      rows.push({
        probe,
        model,
        preset,
        sigBase: base.medianSignals,
        sigProp: prop.medianSignals,
        vibeBase: base.medianVibe,
        vibeProp: prop.medianVibe,
        errBase: base.errored,
        errProp: prop.errored,
      });
      totalSigDelta += prop.medianSignals - base.medianSignals;
      if (base.medianVibe != null && prop.medianVibe != null) {
        totalVibeDelta += prop.medianVibe - base.medianVibe;
        vibeRows++;
      }
    }

    rows.sort((a, b) => {
      const da = a.sigProp - a.sigBase;
      const db = b.sigProp - b.sigBase;
      return da - db;
    });

    lines.push(
      `| probe | model | preset | signals (Δ) | vibe (Δ) | err |`,
      `| --- | --- | --- | --- | --- | --- |`,
    );
    for (const r of rows) {
      const sigDelta = r.sigProp - r.sigBase;
      const sigCell = `${r.sigBase} → ${r.sigProp} (${fmtDelta(sigDelta)})`;
      let vibeCell = "—";
      if (r.vibeBase != null && r.vibeProp != null) {
        const d = r.vibeProp - r.vibeBase;
        vibeCell = `${r.vibeBase.toFixed(2)} → ${r.vibeProp.toFixed(2)} (${fmtDelta(d, 2)})`;
      }
      const errCell = r.errBase + r.errProp > 0 ? `${r.errBase}/${r.errProp}` : "—";
      lines.push(
        `| \`${r.probe}\` | ${r.model} | ${r.preset} | ${sigCell} | ${vibeCell} | ${errCell} |`,
      );
    }
    lines.push("");
    lines.push(
      `**Aggregate:** ${rows.length} cells compared. ` +
        `Total signals delta: ${fmtDelta(totalSigDelta)}. ` +
        (vibeRows > 0
          ? `Mean vibe delta: ${fmtDelta(totalVibeDelta / vibeRows, 3)} (across ${vibeRows} predicted cells).`
          : `(no predicted cells with vibe data.)`),
      "",
    );
  }

  return lines.join("\n");
}

function fmtDelta(n: number, digits = 0): string {
  if (n === 0) return "±0";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

export async function writeVariantsReport(filePath: string, cells: RunCellOutput[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, renderVariantsReport(cells), "utf8");
}
