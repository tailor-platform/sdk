import * as fs from "node:fs";

/**
 * Load a YAML file as an ES module that exports the file content as a string.
 * @param {string} id - Module ID (file path) to check and load
 * @returns {string | undefined} ES module source code, or undefined if not a YAML file
 */
export function loadYamlText(id) {
  if (id.endsWith(".yml") || id.endsWith(".yaml")) {
    const content = fs.readFileSync(id, "utf-8");
    return `export default ${JSON.stringify(content)};`;
  }
}
