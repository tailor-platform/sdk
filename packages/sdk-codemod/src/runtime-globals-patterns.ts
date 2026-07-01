import type { CodemodPatternGroup } from "./types";

const TAILOR_RUNTIME_MEMBER = String.raw`(?:authconnection|context|iconv|idp|secretmanager|workflow)`;
const TAILORDB_RUNTIME_MEMBER = String.raw`(?:Client|CommandType|QueryResult|file)`;
const RUNTIME_MEMBER_SUFFIX = String.raw`(?:\.[A-Za-z_$][\w$]*)?`;
const TAILOR_RUNTIME_ROOT_ACCESS = String.raw`(?:\btailor\s*(?:\.|\?\.|!\s*\.)\s*${TAILOR_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}|\(\s*tailor\s*\)\s*(?:\.|\?\.)\s*${TAILOR_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}|\btailor\s*\[)`;
const TAILORDB_RUNTIME_ROOT_ACCESS = String.raw`(?:\btailordb\s*(?:\.|\?\.|!\s*\.)\s*${TAILORDB_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}|\(\s*tailordb\s*\)\s*(?:\.|\?\.)\s*${TAILORDB_RUNTIME_MEMBER}${RUNTIME_MEMBER_SUFFIX}|\btailordb\s*\[)`;

export const runtimeGlobalTextPattern = new RegExp(
  `(?:${TAILOR_RUNTIME_ROOT_ACCESS}|${TAILORDB_RUNTIME_ROOT_ACCESS}|\\bTailor(?:DBFileError|Errors|ErrorMessage|ErrorItem)\\b)`,
);

export const runtimeGlobalsSourceStringSuspiciousPatterns = [
  /\bnew\s+tailor\.idp\.Client\b/,
  /[=(:,[]\s*tailor\.idp\.Client\b/,
  /[=(:,[]\s*(?:tailor\s*(?:\?\.|!\s*\.)|\(\s*tailor\s*\)\s*\.)\s*idp\.Client\b/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailor\.(?:authconnection|context|iconv|idp|secretmanager|workflow)(?:\.[A-Za-z_$][\w$]*)?\b/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)(?:tailor\s*(?:\?\.|!\s*\.)|\(\s*tailor\s*\)\s*(?:\.|\?\.))\s*(?:authconnection|context|iconv|idp|secretmanager|workflow)(?:\.[A-Za-z_$][\w$]*)?\b/,
  /\btailor\.(?:authconnection|context|iconv|idp|secretmanager|workflow)\.[A-Za-z_$][\w$]*\s*\(/,
  /(?:tailor\s*(?:\?\.|!\s*\.)|\(\s*tailor\s*\)\s*(?:\.|\?\.))\s*(?:authconnection|context|iconv|idp|secretmanager|workflow)\.[A-Za-z_$][\w$]*\s*\(/,
  /\btailor\s*\[/,
  /\btailordb\.file\.[A-Za-z_$][\w$]*\s*\(/,
  /(?:tailordb\s*(?:\?\.|!\s*\.)|\(\s*tailordb\s*\)\s*(?:\.|\?\.))\s*file\.[A-Za-z_$][\w$]*\s*\(/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailordb\.file\b/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)(?:tailordb\s*(?:\?\.|!\s*\.)|\(\s*tailordb\s*\)\s*(?:\.|\?\.))\s*file\b/,
  /(?:\bnew\s+|(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailordb\.(?:Client|CommandType|QueryResult)\b/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)(?:tailordb\s*(?:\?\.|!\s*\.)|\(\s*tailordb\s*\)\s*(?:\.|\?\.))\s*(?:Client|CommandType|QueryResult)\b/,
  /<\s*tailordb\.(?:Client|CommandType|QueryResult)\b/,
  /\btailordb\s*\[/,
  /(?:\bnew\s+|\bthrow\s+|\binstanceof\s+)Tailor(?:DBFileError|Errors|ErrorMessage)\b/,
  /(?:[:=<]\s*|\bas\s+)Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem)\b/,
  /[:<]\s*TailorErrorItem\b/,
] satisfies CodemodPatternGroup[];

export function matchesRuntimeGlobalsSourceString(source: string): boolean {
  return runtimeGlobalsSourceStringSuspiciousPatterns.some((pattern) => pattern.test(source));
}
