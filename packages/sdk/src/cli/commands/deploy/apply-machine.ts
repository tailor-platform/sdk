import * as c from "@toiroakr/chisel";

type StepDeclaration = {
  readonly step: string;
  readonly span?: string;
};

/**
 * The apply calls of each phase, in order. A phase whose name starts with `apply.` runs in a span
 * of that name, and each step with a `span` runs in one of its own.
 */
export const APPLY_PHASE_STEPS = {
  "apply.preflight": [{ step: "tailorDB.preflight" }],
  "apply.createUpdatePrerequisiteServices": [
    { step: "secretManager.create-update", span: "apply.secretManager.createUpdate" },
    { step: "staticWebsite.create-update", span: "apply.staticWebsite.createUpdate" },
    { step: "aiGateway.create-update", span: "apply.aiGateway.createUpdate" },
    { step: "idp.create-update", span: "apply.idp.createUpdate" },
    {
      step: "auth.create-update-prerequisites",
      span: "apply.auth.createUpdatePrerequisites",
    },
  ],
  "apply.createUpdateServices": [
    { step: "functionRegistry.create-update", span: "apply.functionRegistry.createUpdate" },
    { step: "tailorDBReplication.prepare", span: "apply.tailorDBReplication.prepare" },
    { step: "tailorDB.create-update", span: "apply.tailorDB.createUpdate" },
    {
      step: "tailorDBReplication.create-update",
      span: "apply.tailorDBReplication.createUpdate",
    },
    { step: "auth.create-update-dependents", span: "apply.auth.createUpdateDependents" },
    { step: "pipeline.create-update", span: "apply.pipeline.createUpdate" },
  ],
  "apply.deleteSubgraphResources": [
    { step: "pipeline.delete-resources" },
    { step: "auth.delete-resources" },
    { step: "idp.delete-resources" },
  ],
  "apply.createUpdateApplication": [{ step: "app.create-update" }],
  "apply.createUpdateDependentServices": [
    { step: "executor.create-update", span: "apply.executor.createUpdate" },
    // Execution policies must exist before workflow job functions that reference
    // them by key, otherwise the runtime rejects the dispatch as an unknown key.
    {
      step: "workflowExecutionPolicy.create-update",
      span: "apply.workflowExecutionPolicy.createUpdate",
    },
    { step: "workflow.create-update", span: "apply.workflow.createUpdate" },
  ],
  "apply.deleteDependentServices": [
    { step: "workflow.delete" },
    { step: "workflowExecutionPolicy.delete" },
    { step: "executor.delete" },
    { step: "staticWebsite.delete" },
    { step: "aiGateway.delete" },
    { step: "tailorDBReplication.delete" },
    { step: "secretManager.delete" },
  ],
  "apply.deleteApplication": [{ step: "app.delete" }],
  "apply.deleteSubgraphServices": [
    { step: "pipeline.delete-services" },
    { step: "auth.delete-services" },
    { step: "idp.delete-services" },
    { step: "tailorDB.delete-services" },
  ],
  "apply.cleanup": [{ step: "functionRegistry.delete" }],
} as const satisfies Record<string, readonly StepDeclaration[]>;

export type ApplyStepPhase = keyof typeof APPLY_PHASE_STEPS;

/** The span each step that has one runs in. */
export const APPLY_STEP_SPANS: ReadonlyMap<string, string> = new Map(
  Object.values(APPLY_PHASE_STEPS).flatMap((steps: readonly StepDeclaration[]) =>
    steps.flatMap(({ step, span }) => (span === undefined ? [] : [[step, span] as const])),
  ),
);
export type ApplyStep = (typeof APPLY_PHASE_STEPS)[ApplyStepPhase][number]["step"];

/** Writes the metadata labels the phases before it queued. */
const FLUSH = "flushMetadata";
/** Lifts the TailorDB maintenance modes the phases before it held. */
const RELEASE = "releaseMaintenance";
const DONE = "done";

/**
 * The phases of each stage of a deploy's apply. `deployInternal` runs the stages separately so it
 * can rebuild between the last two.
 */
export const APPLY_STAGES = {
  preflight: ["apply.preflight"],
  prerequisites: ["apply.createUpdatePrerequisiteServices", FLUSH],
  remaining: [
    "apply.createUpdateServices",
    "apply.deleteSubgraphResources",
    "apply.createUpdateApplication",
    "apply.createUpdateDependentServices",
    FLUSH,
    "apply.deleteDependentServices",
    "apply.deleteApplication",
    "apply.deleteSubgraphServices",
    "apply.cleanup",
    RELEASE,
  ],
} as const satisfies Record<string, ReadonlyArray<ApplyStepPhase | typeof FLUSH | typeof RELEASE>>;

export type ApplyStage = keyof typeof APPLY_STAGES;

const STAGE_NAMES = Object.keys(APPLY_STAGES) as ApplyStage[];
type PhaseName = ApplyStepPhase | typeof FLUSH | typeof RELEASE | typeof DONE;
const PHASE_NAMES: [PhaseName, ...PhaseName[]] = [
  DONE,
  ...(Object.keys(APPLY_PHASE_STEPS) as ApplyStepPhase[]),
  FLUSH,
  RELEASE,
];

const ApplyState = c.object({
  stage: c.enum(STAGE_NAMES as [ApplyStage, ...ApplyStage[]]),
  phase: c.enum(PHASE_NAMES),
  failed: c.boolean(),
});

export type ApplyState = c.Infer<typeof ApplyState>;
export type ApplyPhase = ApplyState["phase"];

const APPLY_COMMAND = c.enum(["next"]);

function phasesOf(stage: ApplyStage): ReadonlyArray<ApplyPhase> {
  return APPLY_STAGES[stage];
}

function after(stage: ApplyStage, phase: ApplyPhase): ApplyPhase {
  const phases = phasesOf(stage);
  return phases[phases.indexOf(phase) + 1] ?? DONE;
}

// Where a failure goes: the metadata queued so far is written, then the maintenance modes held so
// far are lifted, and nothing else runs.
function cleanupAfter(stage: ApplyStage, phase: ApplyPhase): ApplyPhase {
  const phases = phasesOf(stage);
  return (
    phases.slice(phases.indexOf(phase) + 1).find((next) => next === FLUSH || next === RELEASE) ??
    DONE
  );
}

/**
 * Whether a phase's steps write metadata labels to the batch the stage's flush writes.
 * @param state - State whose phase runs
 * @returns Whether the phase is batched
 */
export function isBatched(state: ApplyState): boolean {
  const { stage, phase } = state;
  const phases = phasesOf(stage);
  return phases.includes(FLUSH) && phases.indexOf(phase) < phases.indexOf(FLUSH);
}

/**
 * Start of an apply stage.
 * @param stage - Stage to start
 * @returns The state the stage starts in
 */
export function applyStart(stage: ApplyStage): ApplyState {
  return { stage, phase: APPLY_STAGES[stage][0], failed: false };
}

type ApplyTransition = c.MachineCommand<ApplyState, "next">;

function transitionOf(
  stage: ApplyStage,
  phase: ApplyPhase,
  state: c.TermOf<ApplyState>,
): ApplyTransition {
  const failure = { stage, phase: cleanupAfter(stage, phase), failed: true };
  if (phase === FLUSH) {
    return {
      effects: [
        c.effect<ApplyState>(
          FLUSH,
          c.choose<ApplyState>(
            state.failed.$eq(true),
            { stage, phase: cleanupAfter(stage, phase), failed: true },
            { stage, phase: after(stage, phase), failed: false },
          ),
          { failure },
        ),
      ],
    };
  }
  if (phase === RELEASE) {
    return {
      effects: [
        c.effect<ApplyState>(RELEASE, { stage, phase: DONE, failed: state.failed }, { failure }),
      ],
    };
  }
  if (phase === DONE) return { state: { stage, phase, failed: state.failed } };
  const steps: readonly StepDeclaration[] = APPLY_PHASE_STEPS[phase];
  return {
    effects: steps.map(({ step }, index) =>
      c.effect<ApplyState>(
        step,
        {
          stage,
          phase: index === steps.length - 1 ? after(stage, phase) : phase,
          failed: false,
        },
        { failure },
      ),
    ),
  };
}

/**
 * The order of a deploy's apply calls, and what a failure of each leaves: the same definition
 * `apply-phases.ts` drives in production and `apply-machine.test.ts` checks exhaustively.
 */
export const applyMachine = c.machine("deploy apply", {
  state: ApplyState,
  command: APPLY_COMMAND,
  initial: STAGE_NAMES.map(applyStart),
  update: (state) => {
    let transition: ApplyTransition = {
      state: { stage: state.stage, phase: state.phase, failed: state.failed },
    };
    for (const stage of STAGE_NAMES.toReversed()) {
      for (const phase of [...phasesOf(stage), DONE as ApplyPhase].toReversed()) {
        transition = c.choose(
          state.stage.$eq(stage).$and(state.phase.$eq(phase)),
          transitionOf(stage, phase, state),
          transition,
        );
      }
    }
    return transition;
  },
});

export { DONE as APPLY_DONE, FLUSH as APPLY_FLUSH, RELEASE as APPLY_RELEASE };
