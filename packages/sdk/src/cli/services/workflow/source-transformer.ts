import { parseSync } from "oxc-parser";
import { type ASTNode, type Replacement, applyReplacements, findStatementEnd } from "./ast-utils";
import { findAllJobs } from "./job-detector";
import { collectSdkBindings, isSdkFunctionCall } from "./sdk-binding-collector";
import type { Program, VariableDeclaration, ExportDefaultDeclaration } from "@oxc-project/types";

/**
 * Find variable declarations by export names
 * Returns a map of export name to statement range
 * @param program - Parsed TypeScript program
 * @returns Map of export name to statement range
 */
function findVariableDeclarationsByName(
  program: Program,
): Map<string, { start: number; end: number }> {
  const declarations = new Map<string, { start: number; end: number }>();

  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;

    const variableDeclaration = declaration as VariableDeclaration;
    for (const declarator of variableDeclaration.declarations) {
      if (declarator.id.type === "Identifier") {
        declarations.set(declarator.id.name, {
          start: statement.start,
          end: statement.end,
        });
      }
    }
  }

  return declarations;
}

/**
 * Find createWorkflow default export declarations
 * Returns the range of the export statement to remove
 * @param program - Parsed TypeScript program
 * @returns Range of the default export statement or null
 */
function findWorkflowDefaultExport(program: Program): { start: number; end: number } | null {
  const bindings = collectSdkBindings(program, "createWorkflow");

  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      const exportDecl = statement as ExportDefaultDeclaration;
      const declaration = exportDecl.declaration;

      // Check for direct createWorkflow call: export default createWorkflow({...})
      if (isSdkFunctionCall(declaration as unknown as ASTNode, bindings, "createWorkflow")) {
        return { start: exportDecl.start, end: exportDecl.end };
      }

      // Check for variable reference that was assigned from createWorkflow
      // This handles: const wf = createWorkflow({...}); export default wf;
      if (declaration.type === "Identifier") {
        return { start: exportDecl.start, end: exportDecl.end };
      }
    }
  }

  return null;
}

/**
 * Transform workflow source code
 * - Other jobs: remove entire variable declaration
 * @param source - The source code to transform
 * @param targetJobName - The name of the target job (from job config)
 * @param targetJobExportName - The export name of the target job (optional, for enhanced detection)
 * @param otherJobExportNames - Export names of other jobs to remove (optional, for enhanced detection)
 * @returns Transformed workflow source code
 */
export function transformWorkflowSource(
  source: string,
  targetJobName: string,
  targetJobExportName?: string,
  otherJobExportNames?: string[],
): string {
  // Use .ts extension to properly parse TypeScript code
  const { program } = parseSync("input.ts", source);

  // Find all jobs using AST detection
  const detectedJobs = findAllJobs(program, source);

  // Defense-in-depth: the bundler already gates this function behind an
  // isJobSourceFile check, so dependency files should not reach here.
  // Guard anyway so that external callers don't accidentally strip exports
  // from files that don't contain the target job.
  const targetJobExistsInFile = detectedJobs.some((j) => j.name === targetJobName);
  if (!targetJobExistsInFile) {
    return source;
  }

  // Find all variable declarations for export name-based removal
  const allDeclarations = findVariableDeclarationsByName(program);

  const replacements: Replacement[] = [];
  const removedStarts = new Set<number>();

  // Step 1: First, collect all ranges that will be removed (other job declarations)
  // This runs before the trigger pass so calls inside sibling jobs are removed first.
  for (const job of detectedJobs) {
    if (job.name === targetJobName) {
      continue;
    }

    if (job.statementRange && !removedStarts.has(job.statementRange.start)) {
      const endPos = findStatementEnd(source, job.statementRange.end);
      removedStarts.add(job.statementRange.start);
      replacements.push({
        start: job.statementRange.start,
        end: endPos,
        text: "",
      });
    } else if (!job.statementRange) {
      // Fallback: replace body with empty function if we can't find the statement
      removedStarts.add(job.bodyValueRange.start);
      replacements.push({
        start: job.bodyValueRange.start,
        end: job.bodyValueRange.end,
        text: "() => {}",
      });
    }
  }

  // Step 2: Remove other jobs by export name (catches jobs missed by AST detection)
  if (otherJobExportNames) {
    for (const exportName of otherJobExportNames) {
      if (exportName === targetJobExportName) continue;

      const declRange = allDeclarations.get(exportName);
      if (declRange && !removedStarts.has(declRange.start)) {
        const endPos = findStatementEnd(source, declRange.end);
        removedStarts.add(declRange.start);
        replacements.push({
          start: declRange.start,
          end: endPos,
          text: "",
        });
      }
    }
  }

  // Step 3: Remove createWorkflow default export (not needed in job bundles)
  const workflowExport = findWorkflowDefaultExport(program);
  if (workflowExport && !removedStarts.has(workflowExport.start)) {
    const endPos = findStatementEnd(source, workflowExport.end);
    removedStarts.add(workflowExport.start);
    replacements.push({
      start: workflowExport.start,
      end: endPos,
      text: "",
    });
  }

  return applyReplacements(source, replacements);
}
