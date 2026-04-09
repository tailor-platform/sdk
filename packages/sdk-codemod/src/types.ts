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
  /** Legacy patterns to detect in unmodified files for manual migration warnings. */
  legacyPatterns?: string[];
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
