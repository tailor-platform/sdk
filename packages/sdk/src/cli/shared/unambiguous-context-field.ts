import { CLIError } from "./errors";

/** A plugin context field whose value is one of several named candidates. */
export interface UnambiguousContextFieldOptions<Key extends string, Value> {
  /** Name of the field. */
  key: Key;
  /** Values the field could hold, keyed by name. */
  candidates: Readonly<Record<string, Value>>;
  /** Plural noun for the candidates in the error message, such as "Auth services". */
  candidatesLabel: string;
  /** Field, or fields, that hold every candidate, named in the error's suggestion. */
  replacement: string | readonly string[];
  /** Throw on read when there is no candidate, instead of holding `undefined`. */
  required?: boolean;
}

/** Options of a field that throws on read when it has no candidate. */
export type RequiredUnambiguousContextFieldOptions<
  Key extends string,
  Value,
> = UnambiguousContextFieldOptions<Key, Value> & { required: true };

function throwingField(error: () => never): PropertyDescriptor {
  return { enumerable: false, configurable: true, get: error };
}

/**
 * Add a plugin context field that holds its only candidate, or `undefined` when there is none.
 * With several candidates, or none when the field is required, reading the field throws an error
 * pointing to the field that holds all of them, while a spread copy leaves the field out, so reading
 * it from the copy gives `undefined` as when there is no candidate.
 * @param target - Plugin context to add the field to
 * @param options - The field and its candidates
 * @returns `target`, with the field added
 */
export function defineUnambiguousContextField<Target extends object, Key extends string, Value>(
  target: Target,
  options: RequiredUnambiguousContextFieldOptions<Key, Value>,
): Target & { [K in Key]: Value };
export function defineUnambiguousContextField<Target extends object, Key extends string, Value>(
  target: Target,
  options: UnambiguousContextFieldOptions<Key, Value>,
): Target & { [K in Key]?: Value };
export function defineUnambiguousContextField<Target extends object, Key extends string, Value>(
  target: Target,
  options: UnambiguousContextFieldOptions<Key, Value>,
): Target & { [K in Key]?: Value } {
  const { key, candidates, candidatesLabel, replacement, required } = options;
  const names = Object.keys(candidates);
  const replacements = typeof replacement === "string" ? [replacement] : replacement;
  const suggestion = `Change the code that reads "${key}" to read ${replacements.map((field) => `"${field}"`).join(" or ")}.`;
  const context = { field: key, replacement: replacements, candidates: names };
  if (names.length === 0 && required) {
    return Object.defineProperty(
      target,
      key,
      throwingField(() => {
        throw CLIError({
          code: "PLUGIN_CONTEXT_FIELD_UNAVAILABLE",
          message: `"${key}" cannot be read because the config has no ${candidatesLabel}.`,
          suggestion,
          context,
        });
      }),
    ) as Target & { [K in Key]?: Value };
  }
  if (names.length <= 1) {
    const [name] = names;
    return Object.defineProperty(target, key, {
      value: name === undefined ? undefined : candidates[name],
      enumerable: true,
      writable: true,
      configurable: true,
    }) as Target & { [K in Key]?: Value };
  }
  return Object.defineProperty(
    target,
    key,
    throwingField(() => {
      throw CLIError({
        code: "PLUGIN_CONTEXT_FIELD_AMBIGUOUS",
        message: `"${key}" cannot be read because the config has ${names.length} ${candidatesLabel}: ${names.join(", ")}.`,
        suggestion,
        context,
      });
    }),
  ) as Target & { [K in Key]?: Value };
}
