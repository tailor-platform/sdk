import type { Probe } from "../types.ts";

export class ProbeRegistry {
  private byId = new Map<string, Probe>();

  add(probe: Probe): void {
    if (this.byId.has(probe.id)) {
      throw new Error(`duplicate probe id: ${probe.id}`);
    }
    this.byId.set(probe.id, probe);
  }

  addAll(probes: Probe[]): void {
    for (const p of probes) this.add(p);
  }

  get(id: string): Probe | undefined {
    return this.byId.get(id);
  }

  list(): Probe[] {
    return [...this.byId.values()];
  }

  filter(predicate: (p: Probe) => boolean): Probe[] {
    return this.list().filter(predicate);
  }
}
