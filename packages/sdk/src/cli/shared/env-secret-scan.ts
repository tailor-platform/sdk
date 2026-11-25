import { createHash } from "node:crypto";
import { logger, styles } from "./logger";
import { configIssuesError } from "./validation-errors";
import type { EnvEntry, EnvValue } from "#/configure/config/types";

const AWS_RULE_ID = "@secretlint/secretlint-rule-aws";
const RULE_ID_PREFIX = "@secretlint/secretlint-rule-";
/**
 * Honors `secretlint-disable` comments found in the scanned text. `env` values
 * are author-controlled text, so leaving this rule in let a value act as a
 * directive and suppress the findings of the entries after it — defeating the
 * check without the explicit allowance.
 *
 * Matched by id on purpose: the rule declares itself a `scanner`, so it cannot
 * be told apart by `meta.type`, and the preset's `disabled` option has no
 * effect on it.
 */
const COMMENT_DIRECTIVE_RULE_ID = "@secretlint/secretlint-rule-filter-comments";
const HIGH_ENTROPY_DETECTOR = "high-entropy";

/**
 * The scanned document is assembled in memory, so the path only labels the
 * source for the scanner and never reaches the filesystem.
 */
const VIRTUAL_SOURCE_PATH = "/tailor-config-env";

const ENTROPY_MIN_LENGTH = 20;
/**
 * Bits per character. Above 4.0 no hex-only string can reach the threshold,
 * which keeps commit hashes, UUIDs and slugs out of the heuristic while still
 * catching base64/base62 credentials.
 */
const ENTROPY_MIN_BITS_PER_CHAR = 4.2;
const TOKEN_LIKE_VALUE = /^[A-Za-z0-9+/=_.-]+$/;

/**
 * A single command can load the same config repeatedly — `setup generate`
 * derives five separate answers, each through its own `loadConfig` — so results
 * are memoized on the entries scanned. Without this the scanner would run, and
 * warnings would print, once per load.
 *
 * Keys are digests rather than the serialized entries, so the cache does not
 * hold the values it was asked to judge for the life of the process.
 */
const scans = new Map<string, Promise<void>>();

interface ProviderFinding {
  /** `env` key holding the value. */
  readonly key: string;
  /** Path of the service whose `env` override holds the value; absent for the root `env`. */
  readonly servicePath?: readonly string[] | undefined;
  /** Short name of what matched, e.g. `slack`, `aws`. */
  readonly detector: string;
  /**
   * Which of the detector's patterns matched, e.g. `AWSAccountID`. A detector
   * can recognize several credential shapes — `aws` alone covers an account id,
   * an access key id and a secret access key — and knowing which one fired is
   * what tells the reader whether the value is actually sensitive.
   */
  readonly rule: string;
  /** Where the matched pattern is documented. */
  readonly docsUrl?: string | undefined;
  /** A provider-specific match fails the command. */
  readonly severity: "error";
}

interface EntropyFinding {
  /** `env` key holding the value. */
  readonly key: string;
  /** Path of the service whose `env` override holds the value; absent for the root `env`. */
  readonly servicePath?: readonly string[] | undefined;
  /** The heuristic matches no named pattern, so it has neither a rule nor documentation. */
  readonly detector: typeof HIGH_ENTROPY_DETECTOR;
  /** A value that only looks randomly generated is reported without failing the command. */
  readonly severity: "warning";
}

type EnvSecretFinding = ProviderFinding | EntropyFinding;

/** `env` entries that override the root `env` for one service, such as `resolver.<namespace>.env`. */
interface EnvOverrideScanInput {
  /** Path of the service that holds the override, e.g. `["resolver", "shop-api"]`. */
  readonly servicePath: readonly string[];
  /** Entries as written in the config. */
  readonly env: Readonly<Record<string, EnvEntry>>;
}

interface EnvSecretScanInput {
  /** `env` entries as written in the config, before `{ value, allowSecretReason }` wrappers are resolved. */
  readonly env?: Readonly<Record<string, EnvEntry>> | undefined;
  /** `env` overrides of services, scanned together with `env`. */
  readonly overrides?: readonly EnvOverrideScanInput[] | undefined;
}

interface EnvSecretAssertInput extends EnvSecretScanInput {
  /** Config file the entries came from; results are cached per config, so a rejection keeps its config's location. */
  readonly configPath: string;
}

type ScannedEntry = {
  readonly key: string;
  readonly servicePath?: readonly string[] | undefined;
  readonly value: EnvValue;
};

type EntryRange = Omit<ScannedEntry, "value"> & {
  readonly start: number;
  readonly end: number;
};

/**
 * Resolve an `env` entry to the value that gets deployed.
 * @param entry - Entry as written in the config
 * @returns The entry's value, unwrapped when it carries an `allowSecretReason`
 */
export function resolveEnvValue(entry: EnvEntry): EnvValue {
  return isAllowedSecret(entry) ? entry.value : entry;
}

/**
 * Scan `env` values for credentials.
 *
 * Entries wrapped as `{ value, allowSecretReason }` are skipped.
 * Provider-specific matches are reported as errors; values that merely look
 * randomly generated are reported as warnings.
 * @param input - `env` entries as written in the config
 * @returns Provider matches first, then entropy warnings; empty when nothing matched
 */
export async function scanEnvForSecrets(input: EnvSecretScanInput): Promise<EnvSecretFinding[]> {
  const sources: {
    servicePath?: readonly string[] | undefined;
    env: Readonly<Record<string, EnvEntry>>;
  }[] = [{ env: input.env ?? {} }, ...(input.overrides ?? [])];
  const entries: ScannedEntry[] = sources.flatMap(({ servicePath, env }) =>
    Object.entries(env)
      .filter(([, entry]) => !isAllowedSecret(entry))
      .map(([key, entry]) => ({
        key,
        ...(servicePath ? { servicePath } : {}),
        value: resolveEnvValue(entry),
      })),
  );
  if (entries.length === 0) {
    return [];
  }

  const findings: EnvSecretFinding[] = await scanWithProviderRules(entries);
  const alreadyFound = new Set(findings.map(formatFindingPath));

  for (const { key, servicePath, value } of entries) {
    if (alreadyFound.has(formatFindingPath({ key, servicePath })) || typeof value !== "string")
      continue;
    if (looksRandomlyGenerated(value)) {
      findings.push({
        key,
        ...(servicePath ? { servicePath } : {}),
        detector: HIGH_ENTROPY_DETECTOR,
        severity: "warning",
      });
    }
  }

  return findings;
}

function findingPath(finding: Pick<ScannedEntry, "key" | "servicePath">): string[] {
  return [...(finding.servicePath ?? []), "env", finding.key];
}

function formatFindingPath(finding: Pick<ScannedEntry, "key" | "servicePath">): string {
  return findingPath(finding).join(".");
}

/**
 * Report secret-looking `env` values, failing when a credential is identified.
 *
 * Warnings are logged and do not fail the command. Repeated calls for the same
 * entries reuse the first result.
 * @param input - `env` entries as written in the config, and the config they came from
 * @returns Promise that resolves when the entries carry no credential
 * @throws CLIError coded `CONFIG_INVALID` when a value is identified as a credential
 */
export async function assertEnvHasNoSecrets(input: EnvSecretAssertInput): Promise<void> {
  const key = createHash("sha256")
    .update(JSON.stringify([input.configPath, input.env ?? {}, input.overrides ?? []]))
    .digest("hex");
  const pending = scans.get(key);
  if (pending) {
    return pending;
  }

  const scan = reportEnvSecrets(input);
  scans.set(key, scan);
  return scan;
}

/**
 * Log warnings and throw on credentials found in `env`.
 * @param input - `env` entries as written in the config, and the config they came from
 * @throws CLIError coded `CONFIG_INVALID` when a value is identified as a credential
 */
async function reportEnvSecrets(input: EnvSecretAssertInput): Promise<void> {
  const findings = await scanEnvForSecrets(input);

  for (const finding of findings) {
    if (finding.severity !== "warning") continue;
    logger.warn(
      `${formatFindingPath(finding)} looks like a randomly generated credential. ` +
        `If it is one, move it to Secret Manager; otherwise allow it with ${styles.bold("allowSecretReason")}.`,
    );
  }

  const errors = findings.filter((finding) => finding.severity === "error");
  const [first] = errors;
  if (!first) {
    return;
  }

  throw configIssuesError({
    file: input.configPath,
    exportName: "default",
    subject: "Tailor config",
    issues: errors.map((error) => {
      const reference = error.docsUrl ? ` See ${error.docsUrl}` : "";
      return {
        path: findingPath(error),
        message: `Secret detected (matched ${error.detector}: ${error.rule}).${reference}`,
      };
    }),
    details:
      "'env' values are deployed as plaintext and are readable by anyone who can read the application's configuration.",
    suggestion:
      "Define these with defineSecretManager() instead, and read them through Secret Manager at runtime.\n" +
      "If a value is genuinely safe to keep in 'env', allow it where it is defined: " +
      `${first.key}: { value: ..., allowSecretReason: "<why this is safe>" }`,
  });
}

/**
 * Run the provider rule set over all entries at once.
 *
 * Entries are scanned as one `KEY=value` document because some rules only match
 * when the key name accompanies the value (`AWS_SECRET_ACCESS_KEY`, database
 * connection strings). Each finding is mapped back to its key through the
 * character range the entry occupies, which stays correct for multi-line values.
 * @param entries - `env` entries to scan
 * @returns Error-severity findings, deduplicated per key and rule
 */
async function scanWithProviderRules(
  entries: ReadonlyArray<ScannedEntry>,
): Promise<ProviderFinding[]> {
  const [{ lintSource }, { recommendedRules: rules }] = await Promise.all([
    import("@secretlint/core"),
    import("@secretlint/core/builtin"),
  ]);

  const ranges: EntryRange[] = [];
  let content = "";
  for (const { key, servicePath, value } of entries) {
    const line = `${key}=${String(value)}`;
    ranges.push({
      key,
      ...(servicePath ? { servicePath } : {}),
      start: content.length,
      end: content.length + line.length,
    });
    content += `${line}\n`;
  }

  const result = await lintSource({
    source: { filePath: VIRTUAL_SOURCE_PATH, content, contentType: "text" },
    options: {
      // Messages embed the matched value, so mask them: nothing this scan
      // produces should be able to print a credential.
      maskSecrets: true,
      noPhysicFilePath: true,
      config: {
        // Registered individually rather than through the preset so the
        // comment-directive rule can be left out (see its id above).
        rules: rules
          .filter((rule) => rule.meta.id !== COMMENT_DIRECTIVE_RULE_ID)
          .map((rule) => ({
            id: rule.meta.id,
            rule,
            // Off by default, and the only way to catch a bare access key id.
            ...(rule.meta.id === AWS_RULE_ID ? { options: { enableIDScanRule: true } } : {}),
          })),
      },
    },
  });

  const findings: ProviderFinding[] = [];
  const seen = new Set<string>();
  for (const message of result.messages) {
    const entry = ranges.find(
      (range) => message.range[0] >= range.start && message.range[0] < range.end,
    );
    if (!entry) continue;

    const detector = message.ruleId.startsWith(RULE_ID_PREFIX)
      ? message.ruleId.slice(RULE_ID_PREFIX.length)
      : message.ruleId;
    const dedupeKey = JSON.stringify([formatFindingPath(entry), detector, message.messageId]);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // The message text embeds the matched value; the identifiers do not.
    findings.push({
      key: entry.key,
      ...(entry.servicePath ? { servicePath: entry.servicePath } : {}),
      detector,
      rule: message.messageId,
      ...(message.docsUrl ? { docsUrl: message.docsUrl } : {}),
      severity: "error",
    });
  }

  return findings;
}

/**
 * Decide whether an entry carries its own allowance.
 * @param entry - Entry as written in the config
 * @returns True when the entry is the `{ value, allowSecretReason }` form
 */
function isAllowedSecret(entry: EnvEntry): entry is Exclude<EnvEntry, EnvValue> {
  return typeof entry === "object";
}

/**
 * Decide whether a value carries enough randomness to look generated rather
 * than authored.
 * @param value - `env` value to inspect
 * @returns True when the value is long, token-shaped and high-entropy
 */
function looksRandomlyGenerated(value: string): boolean {
  if (value.length < ENTROPY_MIN_LENGTH || !TOKEN_LIKE_VALUE.test(value)) {
    return false;
  }
  return shannonEntropyPerChar(value) >= ENTROPY_MIN_BITS_PER_CHAR;
}

/**
 * Compute Shannon entropy of a string in bits per character.
 * @param value - String to measure
 * @returns Bits per character
 */
function shannonEntropyPerChar(value: string): number {
  const occurrences = new Map<string, number>();
  for (const char of value) {
    occurrences.set(char, (occurrences.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of occurrences.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}
