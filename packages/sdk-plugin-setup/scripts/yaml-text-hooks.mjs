import { fileURLToPath } from "node:url";
import { loadYamlText } from "./yaml-text-plugin.mjs";

/**
 * Node module load hook that serves YAML files as modules exporting their text, the
 * same way the tsdown and vitest builds load the workflow templates.
 * @param {string} url - Module URL
 * @param {object} context - Load context
 * @param {Function} nextLoad - Next hook in the chain
 * @returns {Promise<object>} Load result
 */
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:")) {
    const source = loadYamlText(fileURLToPath(url));
    if (source !== undefined) return { format: "module", source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
