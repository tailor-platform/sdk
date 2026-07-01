import type { CodemodPatternGroup } from "./types";

const TAILOR_RUNTIME_MEMBER = String.raw`(?:authconnection|context|iconv|idp|secretmanager|workflow)`;
const TAILORDB_RUNTIME_MEMBER = String.raw`(?:Client|CommandType|QueryResult|file)`;
const RUNTIME_MEMBER_SUFFIX = String.raw`(?:\.[A-Za-z_$][\w$]*)?`;
const CASTED_RUNTIME_ROOT_SUFFIX = String.raw`(?:!\s*)?(?:(?:as|satisfies)\s+[^)]+)?`;
const TAILOR_WRAPPED_RUNTIME_ROOT = String.raw`\(+\s*(?:<[^>]+>\s*)?tailor\s*${CASTED_RUNTIME_ROOT_SUFFIX}\)+`;
const TAILORDB_WRAPPED_RUNTIME_ROOT = String.raw`\(+\s*(?:<[^>]+>\s*)?tailordb\s*${CASTED_RUNTIME_ROOT_SUFFIX}\)+`;
const WRAPPED_RUNTIME_MEMBER_ACCESS = String.raw`\s*(?:\.|\?\.|!\s*\.)\s*`;
const TAILOR_RUNTIME_BRACKET_ACCESS = String.raw`(?:\btailor\s*(?:\?\.|!\s*)?|${TAILOR_WRAPPED_RUNTIME_ROOT}\s*(?:\?\.|!\s*)?)\[`;
const TAILORDB_RUNTIME_BRACKET_ACCESS = String.raw`(?:\btailordb\s*(?:\?\.|!\s*)?|${TAILORDB_WRAPPED_RUNTIME_ROOT}\s*(?:\?\.|!\s*)?)\[`;
const SOURCE_STRING_EXPRESSION_PREFIX = String.raw`(?:(?:=>|[=(:,<{\[])\s*|\b(?:return|await|typeof)\s+)`;
const RUNTIME_ROOT_NAME = String.raw`(?:tailor|tailordb|Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem))`;
const GLOBAL_OBJECT_RUNTIME_ROOT = String.raw`(?:\b(?:globalThis|global)\b|\(+\s*(?:<[^>]+>\s*)?(?:globalThis|global)\s*(?:!\s*)?(?:(?:as|satisfies)\s+[^)]+)?\)+)`;
const GLOBAL_RUNTIME_ROOT_ACCESS = String.raw`${GLOBAL_OBJECT_RUNTIME_ROOT}\s*(?:(?:\.|\?\.|!\s*\.)\s*${RUNTIME_ROOT_NAME}\b|(?:\?\.|!\s*)?\[\s*["']${RUNTIME_ROOT_NAME}["']\s*\])`;
const TAILOR_RUNTIME_ROOT_ACCESS = String.raw`(?:\btailor\s*(?:\.|\?\.|!\s*\.)\s*${TAILOR_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}|${TAILOR_WRAPPED_RUNTIME_ROOT}${WRAPPED_RUNTIME_MEMBER_ACCESS}${TAILOR_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}|${TAILOR_RUNTIME_BRACKET_ACCESS})`;
const TAILORDB_RUNTIME_ROOT_ACCESS = String.raw`(?:\btailordb\s*(?:\.|\?\.|!\s*\.)\s*${TAILORDB_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}|${TAILORDB_WRAPPED_RUNTIME_ROOT}${WRAPPED_RUNTIME_MEMBER_ACCESS}${TAILORDB_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}|${TAILORDB_RUNTIME_BRACKET_ACCESS})`;

export const runtimeGlobalTextPattern = new RegExp(
  `(?:${TAILOR_RUNTIME_ROOT_ACCESS}|${TAILORDB_RUNTIME_ROOT_ACCESS}|\\bTailor(?:DBFileError|Errors|ErrorMessage|ErrorItem)\\b)`,
);
export const globalRuntimeRootTextPattern = new RegExp(GLOBAL_RUNTIME_ROOT_ACCESS);

export const runtimeGlobalsSourceStringSuspiciousPatterns = [
  /\bnew\s+tailor\.idp\.Client\b/,
  /[=(:,[]\s*tailor\.idp\.Client\b/,
  /[=(:,[]\s*(?:tailor\s*(?:\?\.|!\s*\.)|\(\s*tailor\s*\)\s*\.)\s*idp\.Client\b/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailor\.(?:authconnection|context|iconv|idp|secretmanager|workflow)(?:\.[A-Za-z_$][\w$]*)?\b/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)(?:tailor\s*(?:\?\.|!\s*\.)|\(\s*tailor\s*\)\s*(?:\.|\?\.))\s*(?:authconnection|context|iconv|idp|secretmanager|workflow)(?:\.[A-Za-z_$][\w$]*)?\b/,
  new RegExp(
    String.raw`${SOURCE_STRING_EXPRESSION_PREFIX}${TAILOR_WRAPPED_RUNTIME_ROOT}${WRAPPED_RUNTIME_MEMBER_ACCESS}${TAILOR_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}\b`,
  ),
  new RegExp(
    String.raw`\bnew\s+${TAILOR_WRAPPED_RUNTIME_ROOT}${WRAPPED_RUNTIME_MEMBER_ACCESS}${TAILOR_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}\b`,
  ),
  new RegExp(String.raw`${SOURCE_STRING_EXPRESSION_PREFIX}${GLOBAL_RUNTIME_ROOT_ACCESS}`),
  new RegExp(String.raw`\bnew\s+${GLOBAL_RUNTIME_ROOT_ACCESS}`),
  /\btailor\.(?:authconnection|context|iconv|idp|secretmanager|workflow)\.[A-Za-z_$][\w$]*\s*\(/,
  /(?:tailor\s*(?:\?\.|!\s*\.)|\(\s*tailor\s*\)\s*(?:\.|\?\.))\s*(?:authconnection|context|iconv|idp|secretmanager|workflow)\.[A-Za-z_$][\w$]*\s*\(/,
  new RegExp(
    String.raw`${TAILOR_WRAPPED_RUNTIME_ROOT}${WRAPPED_RUNTIME_MEMBER_ACCESS}${TAILOR_RUNTIME_MEMBER}\.[A-Za-z_$][\w$]*\s*\(`,
  ),
  /\btailor\s*\[/,
  new RegExp(TAILOR_RUNTIME_BRACKET_ACCESS),
  /\btailordb\.file\.[A-Za-z_$][\w$]*\s*\(/,
  /(?:tailordb\s*(?:\?\.|!\s*\.)|\(\s*tailordb\s*\)\s*(?:\.|\?\.))\s*file\.[A-Za-z_$][\w$]*\s*\(/,
  new RegExp(
    String.raw`${TAILORDB_WRAPPED_RUNTIME_ROOT}${WRAPPED_RUNTIME_MEMBER_ACCESS}file\.[A-Za-z_$][\w$]*\s*\(`,
  ),
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailordb\.file\b/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)(?:tailordb\s*(?:\?\.|!\s*\.)|\(\s*tailordb\s*\)\s*(?:\.|\?\.))\s*file\b/,
  /(?:\bnew\s+|(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailordb\.(?:Client|CommandType|QueryResult)\b/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)(?:tailordb\s*(?:\?\.|!\s*\.)|\(\s*tailordb\s*\)\s*(?:\.|\?\.))\s*(?:Client|CommandType|QueryResult)\b/,
  new RegExp(
    String.raw`${SOURCE_STRING_EXPRESSION_PREFIX}${TAILORDB_WRAPPED_RUNTIME_ROOT}${WRAPPED_RUNTIME_MEMBER_ACCESS}${TAILORDB_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}\b`,
  ),
  new RegExp(
    String.raw`\bnew\s+${TAILORDB_WRAPPED_RUNTIME_ROOT}${WRAPPED_RUNTIME_MEMBER_ACCESS}${TAILORDB_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}\b`,
  ),
  /<\s*tailordb\.(?:Client|CommandType|QueryResult)\b/,
  /\btailordb\s*\[/,
  new RegExp(TAILORDB_RUNTIME_BRACKET_ACCESS),
  /(?:\bnew\s+|\bthrow\s+|\binstanceof\s+)Tailor(?:DBFileError|Errors|ErrorMessage)\b/,
  /(?:[:=<]\s*|\bas\s+)Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem)\b/,
  /[:<]\s*TailorErrorItem\b/,
] satisfies CodemodPatternGroup[];

export function matchesRuntimeGlobalsSourceString(source: string): boolean {
  return runtimeGlobalsSourceStringSuspiciousPatterns.some((pattern) => pattern.test(source));
}
