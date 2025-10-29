import * as executors from "../../generated-perf/executors";

// Test type inference complexity of Executors
type ExecutorTypes = {
  [K in keyof typeof executors]: (typeof executors)[K];
};

// Force type checking by using the type
const _testExecutors: ExecutorTypes = executors;
void _testExecutors;
