/**
 * `invoker` value expression, inlined into bundler entry wrappers.
 *
 * Calls `tailor.context.getInvoker()` at function entry and maps the server
 * shape to TailorInvoker:
 *   server `attributeMap`  → SDK `attributes`
 *   server `attributes`    → SDK `attributeList`
 *   other fields           → passed through
 *   null (anonymous)       → null
 */
export const INVOKER_EXPR =
  `(invoker => invoker ? (({ attributeMap, attributes: attrList, ...rest }) => ` +
  `({ ...rest, attributes: attributeMap, attributeList: attrList }))(invoker) : null)` +
  `(tailor.context.getInvoker())`;
