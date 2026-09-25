import { generator } from "./tailor.config";

export function describe(label: string): string {
  function f(generator: string): string {
    return generator;
  }
  return f(label);
}
