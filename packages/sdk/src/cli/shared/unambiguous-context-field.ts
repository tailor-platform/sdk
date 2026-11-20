import { CLIError } from "./errors";

/** A plugin context field whose value is one of several named candidates. */
export interface UnambiguousContextFieldOptions<Key extends string, Value> {
  /** Name of the field. */
  key: Key;
  /** Values the field could hold, keyed by name. */
  candidates: Readonly<Record<string, Value>>;
  /** Plural noun for the candidates in the error message, such as "Auth services". */
  candidatesLabel: string;
  /** Field that holds every candidate, named in the error's suggestion. */
  replacement: string;
}

/**
 * Add a plugin context field that holds its only candidate, or `undefined` when there is none.
 * With several candidates, reading the field throws an error pointing to the field that holds all
 * of them, and the field is left out of spread copies.
 * @param target - Plugin context to add the field to
 * @param options - The field and its candidates
 * @returns `target`, with the field added
 */
export function defineUnambiguousContextField<Target extends object, Key extends string, Value>(
  target: Target,
  options: UnambiguousContextFieldOptions<Key, Value>,
): Target & { [K in Key]?: Value } {
  const { key, candidates, candidatesLabel, replacement } = options;
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
        message: `"${key}" cannot be read because the config has ${names.length} ${candidatesLabel}: ${names.join(", ")}.`,
        suggestion: `Change the code that reads "${key}" to read "${replacement}".`,
        context: { field: key, replacement, candidates: names },
      });
    },
  }) as Target & { [K in Key]?: Value };
}
