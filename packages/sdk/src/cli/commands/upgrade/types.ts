/**
 * JSON output from the @tailor-platform/sdk-codemod CLI.
 */
export interface RunOutput {
  codemodsApplied: number;
  codemodsSkipped: number;
  filesModified: string[];
  warnings: string[];
  errors: Array<{ codemodId: string; message: string }>;
  diffOutput?: string;
}
