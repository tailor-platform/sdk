import type { DocsCondition, DocsPreset } from "../types.ts";

export function makeCondition(preset: DocsPreset): DocsCondition {
  switch (preset) {
    case "predicted":
      return {
        preset,
        jsdoc: false,
        packageDocs: false,
        agentFiles: false,
        externalDocs: false,
        llmsTxt: false,
        mcp: false,
      };
    case "bare":
      return {
        preset,
        jsdoc: false,
        packageDocs: false,
        agentFiles: false,
        externalDocs: false,
        llmsTxt: false,
        mcp: false,
      };
    case "jsdoc":
      return {
        preset,
        jsdoc: true,
        packageDocs: false,
        agentFiles: false,
        externalDocs: false,
        llmsTxt: false,
        mcp: false,
      };
    case "docsOnly":
      // L1+L2+L3: type sigs + JSDoc + README/docs, no agent guidance.
      return {
        preset,
        jsdoc: true,
        packageDocs: true,
        agentFiles: false,
        externalDocs: false,
        llmsTxt: false,
        mcp: false,
      };
    case "skillsOnly":
      // L1+L2+L4: type sigs + JSDoc + AGENTS.md/SKILL.md/CLAUDE.md, no docs.
      return {
        preset,
        jsdoc: true,
        packageDocs: false,
        agentFiles: true,
        externalDocs: false,
        llmsTxt: false,
        mcp: false,
      };
    case "inPackage":
      return {
        preset,
        jsdoc: true,
        packageDocs: true,
        agentFiles: true,
        externalDocs: false,
        llmsTxt: false,
        mcp: false,
      };
    case "full":
      return {
        preset,
        jsdoc: true,
        packageDocs: true,
        agentFiles: true,
        externalDocs: true,
        llmsTxt: true,
        mcp: false, // L7 reserved for future
      };
  }
}

export const ALL_PRESETS: DocsPreset[] = ["predicted", "bare", "jsdoc", "inPackage", "full"];

/**
 * `docsOnly` and `skillsOnly` are diagnostic presets used to disentangle
 * L3 (packageDocs) from L4 (agentFiles). They are not part of the default
 * sweep — pass them explicitly via `--conditions`.
 */
export const DIAGNOSTIC_PRESETS: DocsPreset[] = ["docsOnly", "skillsOnly"];

export function conditionKey(c: DocsCondition): string {
  return c.preset;
}
