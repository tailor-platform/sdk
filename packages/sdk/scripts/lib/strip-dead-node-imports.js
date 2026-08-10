const NAMED_IMPORT = /^import \{ ([^}]+) \} from "(node:[^"]+)";\r?\n/gm;

/**
 * @param {string} binding a single named-import binding, e.g. `createRequire` or `x as y`
 * @returns {string} the local identifier the binding introduces
 */
function bindingLocalName(binding) {
  const asIndex = binding.indexOf(" as ");
  return asIndex === -1 ? binding.trim() : binding.slice(asIndex + " as ".length).trim();
}

/**
 * @param {string} source full source text of a generated `.mjs` chunk
 * @returns {string} the source with unused `node:*` named imports removed
 */
export function stripDeadNodeBuiltinImports(source) {
  return source.replace(NAMED_IMPORT, (statement, bindingsRaw, _specifier, offset) => {
    const rest = source.slice(0, offset) + source.slice(offset + statement.length);
    const bindings = bindingsRaw.split(",").map(bindingLocalName);
    const isUsed = bindings.some((name) => new RegExp(`\\b${name}\\b`).test(rest));
    return isUsed ? statement : "";
  });
}
