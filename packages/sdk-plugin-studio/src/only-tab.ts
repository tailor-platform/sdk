/**
 * Narrow the tabs the shell serves to the one named by `--only`.
 * @param tabs - Every tab the shell would serve
 * @param only - Tab id given to `--only`, if any
 * @returns `tabs` unchanged without `only`, otherwise just the tab with that id
 */
export function onlyTab<T extends { id: string }>(tabs: readonly T[], only: string | undefined) {
  if (only === undefined) return tabs;
  const found = tabs.filter((tab) => tab.id === only);
  if (found.length === 0) {
    throw new Error(`No tab "${only}" (available: ${tabs.map((tab) => tab.id).join(", ")})`);
  }
  return found;
}
