/**
 * JavaScript expression string embedded into bundled entry wrappers to compute
 * the `invoker` value passed to user code.
 *
 * The platform runtime exposes `tailor.context.getInvoker()` as a synchronous op
 * returning `{ id, type, workspaceId, attributes: string[], attributeMap: {...} } | null`.
 *
 * We transform the raw shape into SDK convention (matching TailorUser/TailorActor):
 *   platform `attributeMap` → SDK `attributes` (map)
 *   platform `attributes`   → SDK `attributeList` (array)
 *
 * Anonymous callers (`null`) are surfaced as `null` to user code.
 */
export const INVOKER_EXPR = `(($raw) => $raw ? ({
  id: $raw.id,
  type: $raw.type,
  workspaceId: $raw.workspaceId,
  attributes: $raw.attributeMap,
  attributeList: $raw.attributes,
}) : null)(tailor.context.getInvoker())`;
