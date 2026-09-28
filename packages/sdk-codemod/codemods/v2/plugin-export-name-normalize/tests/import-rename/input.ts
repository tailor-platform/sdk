import { generator } from "./tailor.config";

export function listPluginIds(): string[] {
  return generator.map((p) => p.id);
}
