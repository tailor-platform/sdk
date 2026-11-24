const ARG_VALUE = `(?:[^\\s'"\`;&|]+|'[^']*'|"(?:(?:\\\\.)|[^"\\\\])*")`;

const BOOLEAN_GLOBAL_ARG = "(?:--verbose|--json|-j)";
const VALUE_GLOBAL_ARG = "(?:--env-file|--env-file-if-exists|-e)";

/** Any run of global options, each with the whitespace before it. */
export const GLOBAL_ARG_PATTERN = `(?:(?:\\s+${BOOLEAN_GLOBAL_ARG})|(?:\\s+${VALUE_GLOBAL_ARG}(?:=${ARG_VALUE}|\\s+${ARG_VALUE})))*`;

/** The `tailor-sdk` binary, with an optional version pin such as `@latest`. */
export const TAILOR_SDK_BINARY = `(?<![\\w-])tailor-sdk(?:@[^\\s'"\`]+)?(?![\\w-])`;
