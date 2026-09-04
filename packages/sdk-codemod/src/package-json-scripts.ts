type TransformScript = (script: string) => string | null;

export function transformPackageScripts(
  source: string,
  transformScript: TransformScript,
): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }

  const scripts = parsed.scripts;
  if (typeof scripts !== "object" || scripts == null || Array.isArray(scripts)) return null;

  let modified = false;
  for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const updated = transformScript(value);
    if (updated == null || updated === value) continue;
    (scripts as Record<string, unknown>)[name] = updated;
    modified = true;
  }

  if (!modified) return null;
  const trailing = source.endsWith("\n") ? "\n" : "";
  return JSON.stringify(parsed, null, 2) + trailing;
}
