import * as models from "../../generated-perf/models";

// Test type inference complexity of TailorDB models
type ModelTypes = {
  [K in keyof typeof models]: (typeof models)[K];
};

// Force type checking by using the type
const _testModels: ModelTypes = models;
void _testModels;
