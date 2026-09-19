import { plugins } from "./tailor.config";

export function listPluginIds(): string[] {
  return plugins.map((p) => p.id);
}
