import type { CodemodPatternGroup } from "./types";

export const runtimeGlobalTextPattern =
  /(?:\b(?:tailor\.(?:authconnection|context|iconv|idp|secretmanager|workflow)(?:\.[A-Za-z_$][\w$]*)?|tailordb\.(?:Client|CommandType|QueryResult|file)(?:\.[A-Za-z_$][\w$]*)?|Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem))\b|\btailor\s*\[|\btailordb\s*\[)/;

export const runtimeGlobalsSourceStringSuspiciousPatterns = [
  /\bnew\s+tailor\.idp\.Client\b/,
  /[=(:,[]\s*tailor\.idp\.Client\b/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailor\.(?:authconnection|context|iconv|idp|secretmanager|workflow)(?:\.[A-Za-z_$][\w$]*)?\b/,
  /\btailor\.(?:authconnection|context|iconv|idp|secretmanager|workflow)\.[A-Za-z_$][\w$]*\s*\(/,
  /\btailor\s*\[/,
  /\btailordb\.file\.[A-Za-z_$][\w$]*\s*\(/,
  /(?:(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailordb\.file\b/,
  /(?:\bnew\s+|(?:=>|[=(:,<{]|\[)\s*|\b(?:return|await|typeof)\s+)tailordb\.(?:Client|CommandType|QueryResult)\b/,
  /<\s*tailordb\.(?:Client|CommandType|QueryResult)\b/,
  /\btailordb\s*\[/,
  /(?:\bnew\s+|\bthrow\s+|\binstanceof\s+)Tailor(?:DBFileError|Errors|ErrorMessage)\b/,
  /(?:[:=<]\s*|\bas\s+)Tailor(?:DBFileError|Errors|ErrorMessage|ErrorItem)\b/,
  /[:<]\s*TailorErrorItem\b/,
] satisfies CodemodPatternGroup[];

export function matchesRuntimeGlobalsSourceString(source: string): boolean {
  return runtimeGlobalsSourceStringSuspiciousPatterns.some((pattern) => pattern.test(source));
}
