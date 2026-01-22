import { db } from "@/configure/services/tailordb";
import type { PluginBase, PluginProcessContext, PluginOutput } from "@/parser/plugin-config/types";

/**
 * Changeset plugin configuration schema
 */
const configSchema = {
  /**
   * User type for tracking requestedBy, approver references
   */
  // userType: t.string().optional(),
};

/**
 * Process a type and generate changeset-related types
 * @param context - Plugin processing context containing the type to process
 * @returns Plugin output with generated changeset types
 */
function processChangeset(context: PluginProcessContext): PluginOutput {
  const { type } = context;
  const typeName = type.name;

  // Generate the main entity with version control fields
  const mainEntity = db.type(typeName, {
    // Version control fields
    recordId: db.uuid().index(),
    recordState: db.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).index(),
    archivedSeq: db.int(),
    effectiveFrom: db.datetime(),
    effectiveTo: db.datetime({ optional: true }),
    requestedBy: db.uuid().index(),
    requestedAt: db.datetime(),
    currentApprover: db.uuid({ optional: true }).index(),
    approvers: db.uuid({ array: true }),
    // Original fields from the source type are copied
    ...type.fields,
    // Timestamps
    ...db.fields.timestamps(),
  });

  // ChangeRequest - approval process
  const changeRequest = db.type(`${typeName}ChangeRequest`, {
    recordId: db.uuid().index(),
    draft: db.uuid().index(),
    status: db.enum(["RUNNING", "REWORK", "APPROVED", "REJECTED", "CANCELED"]).index(),
    reworkIteration: db.int(),
    currentStepNo: db.int(),
    templateKey: db.string(),
    templateVersion: db.int(),
    requestedBy: db.uuid().index(),
    requestedAt: db.datetime(),
    finalizedAt: db.datetime({ optional: true }),
    effectiveFrom: db.datetime(),
    activationStatus: db.enum(["PENDING", "ACTIVATED"]).index(),
    activatedAt: db.datetime({ optional: true }),
    ...db.fields.timestamps(),
  });

  // ChangeStep - execution step
  const changeStep = db.type(`${typeName}ChangeStep`, {
    request: db.uuid().index(),
    iteration: db.int(),
    stepNo: db.int(),
    stepName: db.string(),
    quorumType: db.enum(["ALL", "ANY"]),
    minApprovals: db.int({ optional: true }),
    status: db.enum(["PENDING", "APPROVED", "REWORK", "REJECTED", "SKIPPED"]).index(),
    startedAt: db.datetime(),
    finishedAt: db.datetime({ optional: true }),
    ...db.fields.timestamps(),
  });

  // ChangeApproval - approval log (audit)
  const changeApproval = db.type(`${typeName}ChangeApproval`, {
    request: db.uuid().index(),
    iteration: db.int(),
    stepNo: db.int(),
    approver: db.uuid().index(),
    decision: db.enum(["PENDING", "APPROVED", "REWORK", "REJECTED"]).index(),
    decidedAt: db.datetime({ optional: true }),
    comment: db.string({ optional: true }),
    resolvedByRuleType: db.enum(["USER", "GROUP", "ROLE", "ORG_MANAGER"]),
    resolvedByRuleValue: db.string({ optional: true }),
    ...db.fields.timestamps(),
  });

  // ChangeReworkEvent - rework log
  const changeReworkEvent = db.type(`${typeName}ChangeReworkEvent`, {
    request: db.uuid().index(),
    iteration: db.int(),
    fromStepNo: db.int(),
    requestedBy: db.uuid().index(),
    requestedAt: db.datetime(),
    reason: db.string({ optional: true }),
    ...db.fields.timestamps(),
  });

  return {
    types: [mainEntity, changeRequest, changeStep, changeApproval, changeReworkEvent],
  };
}

/**
 * Changeset plugin for generating approval flow related types.
 *
 * When applied to a type, generates:
 * - Main entity with version control fields (recordId, recordState, etc.)
 * - ChangeRequest - the approval process
 * - ChangeStep - execution steps
 * - ChangeApproval - approval logs (audit)
 * - ChangeReworkEvent - rework logs
 */
export const changesetPlugin: PluginBase = {
  id: "@tailor-platform/changeset",
  description: "Generates approval flow types for changeset management",
  configSchema,
  process: processChangeset,
};
