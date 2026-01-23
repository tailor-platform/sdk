import { db } from "@/configure/services/tailordb";
import { t } from "@/configure/types";
import type { PluginBase, PluginProcessContext, PluginOutput } from "@/parser/plugin-config/types";

/**
 * Changeset plugin configuration schema
 */
const configSchema = {
  /**
   * Enable changeset generation for this type
   */
  enable: t.bool(),
};

/**
 * Process a type and generate changeset-related types
 * @param context - Plugin processing context containing the type to process
 * @returns Plugin output with generated changeset types
 */
function processChangeset(context: PluginProcessContext): PluginOutput {
  const { type, config } = context;
  const typedConfig = config as { enable?: boolean };

  // Skip if not enabled
  if (!typedConfig.enable) {
    return { types: [] };
  }

  const typeName = type.name;

  // Note: The original type is used as-is. Version control fields should be
  // added to the original type definition by the user if needed.
  // This plugin only generates auxiliary types for the approval workflow.

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
    types: [changeRequest, changeStep, changeApproval, changeReworkEvent],
  };
}

/**
 * Changeset plugin for generating approval flow related types.
 *
 * When applied to a type, generates auxiliary types for approval workflow:
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
