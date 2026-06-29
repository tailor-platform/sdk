const GENERATED_DIR_IGNORE_ENTRY_RE = /^(!?\/?)\.tailor-sdk(\/?)([ \t]*)$/gm;

/**
 * Rewrite exact ignore-file entries for the generated SDK output directory.
 * @param source - File contents
 * @returns Transformed source or null when nothing matched.
 */
export default function transform(source: string): string | null {
  if (!source.includes(".tailor-sdk")) return null;

  const updated = source.replace(
    GENERATED_DIR_IGNORE_ENTRY_RE,
    (_match, prefix: string, slash: string, trailingWhitespace: string) =>
      `${prefix}.tailor${slash}${trailingWhitespace}`,
  );
  return updated === source ? null : updated;
}
