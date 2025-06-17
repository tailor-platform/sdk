import { StepType } from "../types";

export interface ResolverSummary {
  name: string;
  steps: Step[];
}

interface Step {
  type: StepType;
  name: string;
  fn: Function;
}
