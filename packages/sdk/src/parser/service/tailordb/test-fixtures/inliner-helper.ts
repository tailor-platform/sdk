export const IMPORTED_EMAIL_SUFFIX = "@imported.example.com";

/**
 * Normalize imported email using the fixture suffix.
 * @param value - Raw email input.
 * @returns Lower-cased email with fallback suffix.
 */
export function normalizeImportedEmail(value: string | null): string {
  return (value ?? `user${IMPORTED_EMAIL_SUFFIX}`).toLowerCase();
}
