import { logger, styles } from "./logger";

type EnvValue = string | number | boolean;

const AWS_RULE_ID = "@secretlint/secretlint-rule-aws";
const RULE_ID_PREFIX = "@secretlint/secretlint-rule-";
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

/** Severity of a secret-scan finding. */
export type EnvSecretSeverity = "error" | "warning";

/** A secret-looking value found in the application's `env`. */
export interface EnvSecretFinding {
  /** `env` key holding the value. */
  readonly key: string;
  /** Short name of what matched, e.g. `slack`, `aws`, `high-entropy`. */
  readonly detector: string;
  /** `error` for provider-specific matches, `warning` for the entropy heuristic. */
  readonly severity: EnvSecretSeverity;
}

/** Inputs for scanning an application's `env` values. */
export interface EnvSecretScanInput {
  /** Resolved `env` values. */
  readonly env?: Readonly<Record<string, EnvValue>>;
  /** Keys exempted from the scan, mapped to why each value is acceptable. */
  readonly allowEnvSecrets?: Readonly<Record<string, string>>;
}

type ScannedEntry = readonly [key: string, value: EnvValue];

type EntryRange = {
  readonly key: string;
  readonly start: number;
  readonly end: number;
};

/**
 * Scan `env` values for credentials.
 *
 * Provider-specific matches are reported as errors; values that merely look
 * randomly generated are reported as warnings.
 * @param input - `env` values and exempted keys
 * @returns Provider matches first, then entropy warnings; empty when nothing matched
 */
export async function scanEnvForSecrets(input: EnvSecretScanInput): Promise<EnvSecretFinding[]> {
  const exempted = new Set(Object.keys(input.allowEnvSecrets ?? {}));
  const entries = Object.entries(input.env ?? {}).filter(([key]) => !exempted.has(key));
  if (entries.length === 0) {
    return [];
  }

  const findings = await scanWithProviderRules(entries);
  const alreadyFound = new Set(findings.map((finding) => finding.key));

  for (const [key, value] of entries) {
    if (alreadyFound.has(key) || typeof value !== "string") continue;
    if (looksRandomlyGenerated(value)) {
      findings.push({ key, detector: HIGH_ENTROPY_DETECTOR, severity: "warning" });
    }
  }

  return findings;
}

/**
 * Report secret-looking `env` values, failing when a credential is identified.
 *
 * Warnings are logged and do not fail the command.
 * @param input - `env` values and exempted keys
 * @throws When an exempted key is missing from `env`, or a credential is found
 */
export async function assertEnvHasNoSecrets(input: EnvSecretScanInput): Promise<void> {
  assertExemptedKeysExist(input);

  const findings = await scanEnvForSecrets(input);

  for (const finding of findings) {
    if (finding.severity !== "warning") continue;
    logger.warn(
      `env.${finding.key} looks like a randomly generated credential. ` +
        `If it is one, move it to Secret Manager; otherwise exempt it with ${styles.bold("allowEnvSecrets")}.`,
    );
  }

  const errors = findings.filter((finding) => finding.severity === "error");
  if (errors.length === 0) {
    return;
  }

  const list = errors.map((error) => `  - env.${error.key} (matched ${error.detector})`).join("\n");
  const exemption = errors.map((error) => `${error.key}: "<why this is safe>"`).join(", ");
  throw new Error(
    `Secret detected in 'env':\n${list}\n` +
      "'env' values are deployed as plaintext and are readable by anyone who can read the application's configuration. " +
      "Define these with defineSecretManager() instead, and read them through Secret Manager at runtime.\n" +
      `If a value is genuinely safe to keep in 'env', exempt it in defineConfig: allowEnvSecrets: { ${exemption} }`,
  );
}

/**
 * Reject exemptions that no longer match an `env` key, so a renamed or removed
 * key cannot leave a silently ineffective exemption behind.
 * @param input - `env` values and exempted keys
 * @throws When an exempted key is absent from `env`
 */
function assertExemptedKeysExist(input: EnvSecretScanInput): void {
  const exempted = Object.keys(input.allowEnvSecrets ?? {});
  if (exempted.length === 0) {
    return;
  }

  const envKeys = new Set(Object.keys(input.env ?? {}));
  const unknown = exempted.filter((key) => !envKeys.has(key));
  if (unknown.length === 0) {
    return;
  }

  throw new Error(
    `'allowEnvSecrets' exempts keys that 'env' does not define: ${unknown.join(", ")}. ` +
      "Remove the exemption, or fix the key name to match the 'env' entry it should cover.",
  );
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
): Promise<EnvSecretFinding[]> {
  const [{ lintSource }, { creator }] = await Promise.all([
    import("@secretlint/core"),
    import("@secretlint/secretlint-rule-preset-recommend"),
  ]);

  const ranges: EntryRange[] = [];
  let content = "";
  for (const [key, value] of entries) {
    const line = `${key}=${String(value)}`;
    ranges.push({ key, start: content.length, end: content.length + line.length });
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
        rules: [
          {
            id: creator.meta.id,
            rule: creator,
            // Off by default, and the only way to catch a bare access key id.
            rules: [{ id: AWS_RULE_ID, options: { enableIDScanRule: true } }],
          },
        ],
      },
    },
  });

  const detectorsByKey = new Map<string, Set<string>>();
  for (const message of result.messages) {
    const entry = ranges.find(
      (range) => message.range[0] >= range.start && message.range[0] < range.end,
    );
    if (!entry) continue;

    const detector = message.ruleId.startsWith(RULE_ID_PREFIX)
      ? message.ruleId.slice(RULE_ID_PREFIX.length)
      : message.ruleId;
    const detectors = detectorsByKey.get(entry.key);
    if (detectors) {
      detectors.add(detector);
    } else {
      detectorsByKey.set(entry.key, new Set([detector]));
    }
  }

  return [...detectorsByKey].flatMap(([key, detectors]) =>
    [...detectors].map((detector) => ({ key, detector, severity: "error" as const })),
  );
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
