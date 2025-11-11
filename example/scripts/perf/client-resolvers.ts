import * as resolvers from "../../generated-perf/resolvers";

// Test type inference complexity of Pipeline resolvers
type ResolverTypes = {
  [K in keyof typeof resolvers]: (typeof resolvers)[K];
};

// Force type checking by using the type
const _testResolvers: ResolverTypes = resolvers;
void _testResolvers;
