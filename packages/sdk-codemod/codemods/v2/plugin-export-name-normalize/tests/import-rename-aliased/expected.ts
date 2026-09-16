import { plugins as myGen } from "./tailor.config";

export function listPluginIds(): string[] {
  return myGen.map((p) => p.id);
}
