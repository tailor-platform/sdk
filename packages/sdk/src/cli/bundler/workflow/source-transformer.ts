import { parseSync } from "oxc-parser";
import { type ASTNode, type Replacement, applyReplacements, findStatementEnd } from "./ast-utils";
import { findAllJobs, buildJobNameMap, detectTriggerCalls } from "./job-detector";
import { collectSdkBindings, isSdkFunctionCall } from "./sdk-binding-collector";
import type {
  Program,
  VariableDeclaration,
  ExportNamedDeclaration,
  ExportDefaultDeclaration,
} from "@oxc-project/types";

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

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;

    const nodeType = node.type as string | undefined;

    // Handle variable declarations: const job1 = ...
    // Only set if not already set (ExportNamedDeclaration is processed first and sets the outer range)
    if (nodeType === "VariableDeclaration") {
      const varDecl = node as unknown as VariableDeclaration;
      for (const decl of varDecl.declarations || []) {
        if (decl.id?.type === "Identifier" && decl.id.name) {
          if (!declarations.has(decl.id.name)) {
            declarations.set(decl.id.name, {
              start: varDecl.start,
              end: varDecl.end,
            });
          }
        }
      }
    }

    // Handle export declarations: export const job1 = ...
    if (nodeType === "ExportNamedDeclaration") {
      const exportDecl = node as unknown as ExportNamedDeclaration;
      const declaration = exportDecl.declaration;
      if (declaration?.type === "VariableDeclaration") {
        const varDecl = declaration as VariableDeclaration;
        for (const decl of varDecl.declarations || []) {
          if (decl.id?.type === "Identifier" && decl.id.name) {
            declarations.set(decl.id.name, {
              start: exportDecl.start,
              end: exportDecl.end,
            });
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      const child = node[key] as unknown;
      if (Array.isArray(child)) {
        child.forEach((c: unknown) => walk(c as ASTNode | null));
      } else if (child && typeof child === "object") {
        walk(child as ASTNode);
      }
    }
  }

  walk(program as unknown as ASTNode);
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
 * - Transform .trigger() calls to tailor.workflow.triggerJobFunction()
 * - Other jobs: remove entire variable declaration
 * @param source - The source code to transform
 * @param targetJobName - The name of the target job (from job config)
 * @param [targetJobExportName] - The export name of the target job (optional, for enhanced detection)
 * @param [otherJobExportNames] - Export names of other jobs to remove (optional, for enhanced detection)
 * @param [allJobsMap] - Map from export name to job name for trigger transformation (optional)
 * @returns Transformed workflow source code
 */
export function transformWorkflowSource(
  source: string,
  targetJobName: string,
  targetJobExportName?: string,
  otherJobExportNames?: string[],
  allJobsMap?: Map<string, string>,
): string {
  // Use .ts extension to properly parse TypeScript code
  const { program } = parseSync("input.ts", source);

  // Find all jobs using AST detection
  const detectedJobs = findAllJobs(program, source);

  // Build job name map from detected jobs if not provided
  const jobNameMap = allJobsMap ?? buildJobNameMap(detectedJobs);

  // Find all variable declarations for export name-based removal
  const allDeclarations = findVariableDeclarationsByName(program);

  // Detect all .trigger() calls
  const triggerCalls = detectTriggerCalls(program, source);

  const replacements: Replacement[] = [];
  const removedRanges: Array<{ start: number; end: number }> = [];

  // Helper to check if a position is inside any removed range
  const isInsideRemovedRange = (pos: number) => {
    return removedRanges.some((r) => pos >= r.start && pos < r.end);
  };

  // Helper to track removed ranges (avoid duplicate/overlapping removals)
  // Use start position only for comparison since end position may vary due to findStatementEnd
  const isAlreadyMarkedForRemoval = (start: number) => {
    return removedRanges.some((r) => r.start === start);
  };

  // Step 1: First, collect all ranges that will be removed (other job declarations)
  // This must happen before trigger transformation to know which trigger calls to skip
  for (const job of detectedJobs) {
    if (job.name === targetJobName) {
      continue;
    }

    if (job.statementRange && !isAlreadyMarkedForRemoval(job.statementRange.start)) {
      const endPos = findStatementEnd(source, job.statementRange.end);
      removedRanges.push({ start: job.statementRange.start, end: endPos });
      replacements.push({
        start: job.statementRange.start,
        end: endPos,
        text: "",
      });
    } else if (!job.statementRange) {
      // Fallback: replace body with empty function if we can't find the statement
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
      if (declRange && !isAlreadyMarkedForRemoval(declRange.start)) {
        const endPos = findStatementEnd(source, declRange.end);
        removedRanges.push({ start: declRange.start, end: endPos });
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
  if (workflowExport && !isAlreadyMarkedForRemoval(workflowExport.start)) {
    const endPos = findStatementEnd(source, workflowExport.end);
    removedRanges.push({ start: workflowExport.start, end: endPos });
    replacements.push({
      start: workflowExport.start,
      end: endPos,
      text: "",
    });
  }

  // Step 4: Transform .trigger() calls to tailor.workflow.triggerJobFunction()
  // Only transform trigger calls that are NOT inside ranges being removed
  // Also remove await keyword since triggerJobFunction is synchronous
  for (const call of triggerCalls) {
    // Skip trigger calls inside removed job declarations
    if (isInsideRemovedRange(call.callRange.start)) {
      continue;
    }

    const jobName = jobNameMap.get(call.identifierName);
    if (jobName) {
      // Transform to tailor.workflow.triggerJobFunction
      // triggerJobFunction is synchronous, so we use fullRange to remove await if present
      const transformedCall = `tailor.workflow.triggerJobFunction("${jobName}", ${call.argsText || "undefined"})`;
      replacements.push({
        start: call.fullRange.start,
        end: call.fullRange.end,
        text: transformedCall,
      });
    }
  }

  return applyReplacements(source, replacements);
}
