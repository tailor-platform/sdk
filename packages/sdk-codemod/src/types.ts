/** A before/after code pair shown in the generated migration doc. */
export interface CodemodExample {
  /** Code as written before the migration. */
  before: string;
  /** Code after the migration. */
  after: string;
  /** Optional one-line caption explaining the example. */
  caption?: string;
  /** Fenced-code-block language for the example (default: "ts"). */
  lang?: string;
}

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
  /**
   * Substrings that, when present in a file's post-transform content, mark it
   * as a candidate for LLM-assisted review. Use this for migrations the
   * deterministic transform cannot safely complete on its own (e.g. a value
   * reached through a variable or a dynamic expression). Unlike
   * `legacyPatterns`, these do not need to be exhaustive: a broad signal such
   * as the API name is enough to point an LLM at the right files. Has no effect
   * unless `prompt` is also set.
   */
  suspiciousPatterns?: string[];
  /**
   * Prompt that instructs an LLM how to finish the migration for files matched
   * by `suspiciousPatterns`.
   */
  prompt?: string;
  /** Before/after examples shown in the generated migration doc. */
  examples?: CodemodExample[];
}

/** A batch of files an LLM should review for one codemod, with its prompt. */
export interface LlmReview {
  /** Codemod id that flagged these files. */
  codemodId: string;
  /** Prompt describing the migration for an LLM. */
  prompt: string;
  /** Files (relative to the target) that matched a suspicious pattern. */
  files: string[];
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
  /** Files flagged for LLM-assisted review, grouped by codemod. */
  llmReviews: LlmReview[];
}
