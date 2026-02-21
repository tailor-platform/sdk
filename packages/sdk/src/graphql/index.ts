/**
 * GraphQL type inference module for TailorDB.
 *
 * Provides type-level utilities for inferring GraphQL input/output types
 * from TailorDB type definitions, and a module augmentation interface
 * for registering generated GraphQL schema types.
 */

export type {
  ExtractRootField,
  GqlVariables,
  GqlResult,
  GeneratedGqlSchema,
  GeneratedGqlTypes,
  InferCreateInput,
  InferUpdateInput,
  InferGqlResult,
  ParsedGqlVariables,
  ResolvedGqlVariables,
  StrictKeys,
} from "./infer";
