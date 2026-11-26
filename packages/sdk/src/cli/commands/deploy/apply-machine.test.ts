import {
  checkMachine,
  invariant,
  runMachine,
  specifyMachine,
  transition,
} from "@toiroakr/chisel/full";
import { describe, expect, test } from "vitest";
import {
  APPLY_DONE,
  APPLY_FLUSH,
  APPLY_PHASE_STEPS,
  APPLY_RELEASE,
  APPLY_STAGES,
  applyMachine,
  applyStart,
  type ApplyState,
} from "./apply-machine";

const specification = specifyMachine(applyMachine, {
  invariants: [
    invariant<ApplyState>("a failed apply runs no resource step", (state) =>
      state.failed
        .$eq(false)
        .$or(state.phase.$eq(APPLY_FLUSH))
        .$or(state.phase.$eq(APPLY_RELEASE))
        .$or(state.phase.$eq(APPLY_DONE)),
    ),
  ],
  transitions: [
    transition<ApplyState>("a failure stays failed", (before, after) =>
      before.failed.$eq(false).$or(after.failed.$eq(true)),
    ),
    transition<ApplyState>(
      "resources are deleted only once the queued metadata is written",
      (before, after) =>
        after.phase
          .$ne("apply.deleteDependentServices")
          .$or(before.phase.$eq(APPLY_FLUSH))
          .$or(before.phase.$eq("apply.deleteDependentServices")),
    ),
    transition<ApplyState>(
      "the remaining resources finish only once the maintenance modes are lifted",
      (before, after) =>
        after.stage
          .$ne("remaining")
          .$or(after.phase.$ne(APPLY_DONE))
          .$or(before.phase.$eq(APPLY_RELEASE))
          .$or(before.phase.$eq(APPLY_DONE)),
    ),
    transition<ApplyState>(
      "the prerequisites finish only once the queued metadata is written",
      (before, after) =>
        after.stage
          .$ne("prerequisites")
          .$or(after.phase.$ne(APPLY_DONE))
          .$or(before.phase.$eq(APPLY_FLUSH))
          .$or(before.phase.$eq(APPLY_DONE)),
    ),
  ],
});

function performedOn(state: ApplyState, fails: (name: string) => boolean = () => false): string[] {
  const names: string[] = [];
  let current = state;
  while (current.phase !== APPLY_DONE) {
    const { state: next, steps } = runMachine(applyMachine, current, "next", {
      fails: ({ name }) => fails(name),
    });
    names.push(...steps.flatMap((step) => step.performed?.map(({ name }) => name) ?? []));
    current = next;
  }
  return names;
}

describe("applyMachine", () => {
  test("holds its properties for every failure of every apply call", () => {
    const report = checkMachine(specification);
    expect(report.status).toBe("held");
  });

  test("applies every step of a stage in the order its phases list them", () => {
    for (const [stage, phases] of Object.entries(APPLY_STAGES) as Array<
      [keyof typeof APPLY_STAGES, ReadonlyArray<string>]
    >) {
      const expected = phases.flatMap((phase) =>
        phase in APPLY_PHASE_STEPS
          ? APPLY_PHASE_STEPS[phase as keyof typeof APPLY_PHASE_STEPS].map(({ step }) => step)
          : [phase],
      );
      expect(performedOn(applyStart(stage))).toEqual(expected);
    }
  });

  test("creates execution policies before the workflows that reference them", () => {
    const performed = performedOn(applyStart("remaining"));
    expect(performed.indexOf("workflowExecutionPolicy.create-update")).toBeLessThan(
      performed.indexOf("workflow.create-update"),
    );
  });

  test("writes the queued metadata and lifts maintenance modes after a failed step, and runs nothing else", () => {
    expect(
      performedOn(applyStart("remaining"), (name) => name === "executor.create-update"),
    ).toEqual([
      ...APPLY_PHASE_STEPS["apply.createUpdateServices"].map(({ step }) => step),
      ...APPLY_PHASE_STEPS["apply.deleteSubgraphResources"].map(({ step }) => step),
      "app.create-update",
      "executor.create-update",
      APPLY_FLUSH,
      APPLY_RELEASE,
    ]);
  });
});
