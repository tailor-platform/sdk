/**
 * JSON output from the @tailor-platform/sdk-codemod CLI.
 */
export interface RunOutput {
  codemodsApplied: number;
  codemodsSkipped: number;
  filesModified: string[];
  warnings: string[];
  errors: Array<{ codemodId: string; message: string }>;
  /** Changes a codemod could not migrate on its own, with the prompt that describes them. */
  llmReviews: Array<{
    codemodId: string;
    prompt: string;
    /** Files relative to the upgraded project; empty when the whole project needs a review. */
    files: string[];
    findings?: Array<{ file: string; line: number; message: string; excerpt: string }>;
  }>;
}
