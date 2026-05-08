import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Probe } from "../types.ts";
import { ProbeSchema } from "./schema.ts";

export async function loadProbe(filePath: string): Promise<Probe> {
  const raw = await readFile(filePath, "utf8");
  const parsed = parseYaml(raw) as unknown;
  const validated = ProbeSchema.parse(parsed);
  return validated as Probe;
}

export async function loadProbesFromDir(dir: string): Promise<Probe[]> {
  const { readdir, stat } = await import("node:fs/promises");
  const out: Probe[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d);
    for (const entry of entries) {
      const full = join(d, entry);
      const st = await stat(full);
      if (st.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
      out.push(await loadProbe(full));
    }
  }
  await walk(dir);
  return out;
}

export function probeShortName(p: Probe): string {
  return basename(p.id);
}

export function probeCategoryDir(p: Probe, root: string): string {
  return join(root, p.category, dirname(p.id));
}
