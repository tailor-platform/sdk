/** A global option of the CLI, spelled `--name` and, when it has one, `-alias`. */
export interface GlobalOption {
  name: string;
  alias?: string;
}

/** The global options that take a value. */
export const GLOBAL_VALUE_OPTIONS: readonly GlobalOption[] = [
  { name: "env-file", alias: "e" },
  { name: "env-file-if-exists" },
];

/** The global flags that take no value. */
export const GLOBAL_BOOLEAN_OPTIONS: readonly GlobalOption[] = [
  { name: "verbose" },
  { name: "json", alias: "j" },
];

function toCamelCase(name: string): string {
  return name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
}

function longSpellings(name: string): string[] {
  const camel = toCamelCase(name);
  return camel === name ? [`--${name}`] : [`--${name}`, `--${camel}`];
}

function negatedSpellings(name: string): string[] {
  const camel = toCamelCase(name);
  return [`--no-${name}`, `--no${camel.charAt(0).toUpperCase()}${camel.slice(1)}`];
}

/** Every spelling of the global options that take a value, as the CLI accepts them. */
export const GLOBAL_VALUE_FLAGS: readonly string[] = GLOBAL_VALUE_OPTIONS.flatMap((option) => [
  ...longSpellings(option.name),
  ...(option.alias === undefined ? [] : [`-${option.alias}`]),
]);

/** Every spelling of the global flags that take no value, including their negated forms. */
export const GLOBAL_BOOLEAN_FLAGS: readonly string[] = GLOBAL_BOOLEAN_OPTIONS.flatMap((option) => [
  ...longSpellings(option.name),
  ...(option.alias === undefined ? [] : [`-${option.alias}`]),
  ...negatedSpellings(option.name),
]);
