import { db } from "@/configure/services/tailordb";
import { t } from "@/configure/types";
import type { output } from "@/configure/types/helpers";
import type { PluginBase, PluginProcessContext, PluginOutput } from "@/parser/plugin-config/types";

/**
 * Changeset plugin configuration schema
 */
const configSchema = t.bool().validate(({ value }) => value === true);

/**
 * Process a type and generate changeset-related types
 * @param context - Plugin processing context containing the type to process
 * @returns Plugin output with generated changeset types and extended fields
 */
function processChangeset(
  context: PluginProcessContext<output<typeof configSchema>>,
): PluginOutput {
  const { type, config } = context;
  if (!config) {
    return { types: [] };
  }

  const typeName = type.name;

  // Fields to add to the original type for version control
  const extendFields = {
    recordId: db.uuid().index().description("Unique identifier for the record across versions"),
    recordState: db
      .enum(["DRAFT", "ACTIVE", "ARCHIVED"])
      .index()
      .description("Current state of the record"),
    archivedSeq: db.int().description("Sequence number for archived versions"),
    effectiveFrom: db.datetime().description("When this version becomes effective"),
    effectiveTo: db.datetime({ optional: true }).description("When this version expires"),
    requestedBy: db.uuid().index().description("User who requested the change"),
    requestedAt: db.datetime().description("When the change was requested"),
    currentApprover: db
      .uuid({ optional: true })
      .index()
      .description("Current approver in the workflow"),
    approvers: db.uuid({ array: true }).description("List of approvers for this change"),
  };

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
    extends: { fields: extendFields },
  };
}

/**
 * Changeset plugin for generating approval flow related types.
 *
 * When applied to a type:
 * 1. Extends the original type with version control fields (recordId, recordState, etc.)
 * 2. Generates auxiliary types for approval workflow:
 *    - ChangeRequest - the approval process
 *    - ChangeStep - execution steps
 *    - ChangeApproval - approval logs (audit)
 *    - ChangeReworkEvent - rework logs
 */
export const changesetPlugin: PluginBase = {
  id: "@tailor-platform/changeset",
  description: "Generates approval flow types for changeset management",
  configSchema,
  process: processChangeset,
};
