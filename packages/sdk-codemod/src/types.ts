/**
 * Metadata for a codemod package.
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
  /** Custom file glob patterns. Defaults to TypeScript patterns when omitted. */
  filePatterns?: string[];
  /**
   * Patterns to detect in post-transform file content for manual migration
   * warnings. A plain string warns when that substring is present; a
   * `string[]` group warns only when every substring in the group is present
   * (AND), letting a rule target a co-occurrence such as `executeScript` used
   * together with `JSON.stringify`.
   */
  legacyPatterns?: Array<string | string[]>;
}

/**
 * JSON output written to stdout by the sdk-codemod CLI.
 */
export interface RunOutput {
  codemodsApplied: number;
  codemodsSkipped: number;
  filesModified: string[];
  warnings: string[];
  errors: Array<{ codemodId: string; message: string }>;
}
