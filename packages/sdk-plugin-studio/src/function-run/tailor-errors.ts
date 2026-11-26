export interface TailorErrorItem {
  message: string;
  path: (string | number)[];
}

const MARKER = "TailorErrors: ";

function isItem(value: unknown): value is TailorErrorItem {
  if (typeof value !== "object" || value === null) return false;
  const { message, path } = value as { message?: unknown; path?: unknown };
  return (
    typeof message === "string" &&
    Array.isArray(path) &&
    path.every((segment) => typeof segment === "string" || typeof segment === "number")
  );
}

/**
 * Read the items of a `TailorErrors` out of the error text of a function run, where the
 * platform serializes them as `TailorErrors: {"errors":[{"message":…,"path":[…]}]}`.
 * @param text - The `error` of a run record
 * @returns The items, or an empty list when the text holds no `TailorErrors`
 */
export function parseTailorErrors(text: string | undefined): TailorErrorItem[] {
  const start = text?.indexOf(MARKER) ?? -1;
  if (text === undefined || start < 0) return [];
  const payload = text.slice(start + MARKER.length).split("\n", 1)[0] ?? "";
  try {
    const { errors } = JSON.parse(payload) as { errors?: unknown };
    return Array.isArray(errors) ? errors.filter(isItem) : [];
  } catch {
    return [];
  }
}
