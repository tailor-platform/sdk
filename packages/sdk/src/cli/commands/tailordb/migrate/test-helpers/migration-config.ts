export function migrationDbConfig(
  namespaces: readonly string[],
  baseDirectory: string,
): Record<string, { migration: { directory: string } }> {
  return Object.fromEntries(
    namespaces.map((namespace, index) => [
      namespace,
      { migration: { directory: index === 0 ? baseDirectory : `${baseDirectory}-${namespace}` } },
    ]),
  );
}
