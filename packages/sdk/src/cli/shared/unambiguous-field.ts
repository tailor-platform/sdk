import { CLIError } from "./errors";

/** A field whose value is one of several named candidates. */
export interface UnambiguousFieldOptions<Key extends string, Value> {
  /** Name of the field. */
  key: Key;
  /** Values the field could hold, keyed by name. */
  candidates: Readonly<Record<string, Value>>;
  /** Plural noun for the candidates in the error message, such as "Auth services". */
  kind: string;
  /** Field that holds every candidate, named in the error's suggestion. */
  replacement: string;
}

/**
 * Add a field that holds its only candidate. With several candidates, reading the field throws an
 * error pointing to the field that holds all of them, and the field is left out of spread copies.
 * @param target - Object to add the field to
 * @param options - The field and its candidates
 * @returns `target`, with the field added
 */
export function defineUnambiguousField<Target extends object, Key extends string, Value>(
  target: Target,
  options: UnambiguousFieldOptions<Key, Value>,
): Target & { [K in Key]?: Value } {
  const { key, candidates, kind, replacement } = options;
  const names = Object.keys(candidates);
  if (names.length <= 1) {
    const [name] = names;
    return Object.defineProperty(target, key, {
      value: name === undefined ? undefined : candidates[name],
      enumerable: true,
      writable: true,
      configurable: true,
    }) as Target & { [K in Key]?: Value };
  }
  return Object.defineProperty(target, key, {
    enumerable: false,
    configurable: true,
    get(): never {
      throw CLIError({
        code: "PLUGIN_CONTEXT_FIELD_AMBIGUOUS",
        message: `"${key}" cannot be read because the config has ${names.length} ${kind}: ${names.join(", ")}.`,
        suggestion: `Read "${replacement}" instead.`,
        context: { field: key, replacement, candidates: names },
      });
    },
  }) as Target & { [K in Key]?: Value };
}
