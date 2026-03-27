/**
 * Migration rule that describes a single codemod transformation.
 * Each rule targets a specific breaking change for a version upgrade.
 */
export interface MigrationRule {
  /** Unique rule identifier (e.g., "v2/define-generators") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Description of what this rule migrates */
  description: string;
  /** Minimum source version this rule applies from (semver, inclusive) */
  since: string;
  /** Maximum source version this rule applies to (semver, exclusive) */
  until: string;
  /** Custom file glob patterns. Defaults to TypeScript patterns when omitted. */
  filePatterns?: string[];
  /** The codemod transformation function */
  transform: (context: TransformContext) => Promise<TransformResult>;
}

/**
 * Context provided to each migration rule's transform function.
 */
export interface TransformContext {
  /** Absolute path to the project root directory */
  projectRoot: string;
  /** List of target file paths (resolved from globs) */
  files: string[];
  /** Whether to only preview changes without writing */
  dryRun: boolean;
  /**
   * In-memory file content overrides from previous rules.
   * When present, rules should read from this map instead of disk for files
   * that have been modified by earlier rules in the same pipeline run.
   * This ensures dry-run mode correctly chains intermediate results.
   */
  fileOverrides?: ReadonlyMap<string, string>;
}

/**
 * Before/after content of a single file transformation (for dry-run diff).
 */
export interface FileDiff {
  file: string;
  before: string;
  after: string;
}

/**
 * Result of applying a single migration rule.
 */
export interface TransformResult {
  /** Whether any changes were made (or would be made in dry-run) */
  changed: boolean;
  /** Files that were modified (or would be modified in dry-run) */
  filesModified: string[];
  /** Warnings about manual intervention needed */
  warnings: string[];
  /** Before/after content for changed files (populated in dry-run mode) */
  diffs?: FileDiff[];
}

/**
 * Summary of the entire migration run.
 */
export interface MigrationSummary {
  /** Total rules that were applied */
  rulesApplied: number;
  /** Total rules that were skipped (no applicable changes) */
  rulesSkipped: number;
  /** Total files modified across all rules */
  filesModified: string[];
  /** Warnings from all rules */
  warnings: string[];
  /** Rules that had errors during execution */
  errors: Array<{ ruleId: string; error: Error }>;
  /** Before/after content for changed files (populated in dry-run mode) */
  diffs?: FileDiff[];
}
