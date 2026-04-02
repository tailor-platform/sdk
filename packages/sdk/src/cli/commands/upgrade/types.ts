/**
 * Metadata for a codemod package that can be applied during an upgrade.
 */
export interface CodemodPackage {
  /** Unique identifier (e.g., "v2/define-generators-to-plugins") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Description of what this codemod transforms */
  description: string;
  /** Minimum source version this codemod applies from (semver, inclusive) */
  since: string;
  /** Target version this codemod upgrades to (semver, exclusive upper bound) */
  until: string;
  /** Path to the jssg transform script relative to the codemods root */
  scriptPath: string;
  /** Target language for codemod CLI (default: "typescript") */
  language?: string;
}

/**
 * Result of running a single codemod via the codemod CLI.
 */
export interface CodemodResult {
  /** The codemod package that was run */
  codemod: CodemodPackage;
  /** Whether the codemod made any changes */
  changed: boolean;
  /** Files that were modified */
  filesModified: string[];
  /** Warnings about manual intervention needed */
  warnings: string[];
}

/**
 * Summary of the entire upgrade run.
 */
export interface UpgradeSummary {
  /** Total codemods that were applied (made changes) */
  codemodsApplied: number;
  /** Total codemods that were skipped (no changes needed) */
  codemodsSkipped: number;
  /** Total files modified across all codemods */
  filesModified: string[];
  /** Warnings from all codemods */
  warnings: string[];
  /** Codemods that had errors during execution */
  errors: Array<{ codemodId: string; error: Error }>;
}
