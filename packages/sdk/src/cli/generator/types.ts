import { type Executor } from "@/parser/service/executor";
import { type Resolver } from "@/parser/service/resolver";
import type { IdProviderConfig, OAuth2ClientInput } from "@/parser/service/auth/types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

// ========================================
// Basic types
// ========================================

interface GeneratedFile {
  path: string;
  content: string;
  skipIfExists?: boolean; // default: false
  executable?: boolean; // default: false - if true, sets chmod +x
}

export interface GeneratorResult {
  files: GeneratedFile[];
  errors?: string[];
}

// Namespace results for TailorDB
export interface TailorDBNamespaceResult<T> {
  namespace: string;
  types: T;
}

// Namespace results for Resolver
export interface ResolverNamespaceResult<R> {
  namespace: string;
  resolvers: R;
}

// Auth configuration for generators
export interface GeneratorAuthInput {
  name: string;
  userProfile?: {
    typeName: string;
    namespace: string;
    usernameField: string;
  };
  machineUsers?: Record<string, { attributes: Record<string, unknown> }>;
  oauth2Clients?: Record<string, OAuth2ClientInput>;
  idProvider?: IdProviderConfig;
}

// ========================================
// Dependency types
// ========================================

export type DependencyKind = "tailordb" | "resolver" | "executor";

// Check if array includes a specific element
type ArrayIncludes<T extends readonly unknown[], U> = T extends readonly [
  infer First,
  ...infer Rest,
]
  ? First extends U
    ? true
    : ArrayIncludes<Rest, U>
  : false;

// Check if dependencies array includes a specific dependency
export type HasDependency<
  Deps extends readonly DependencyKind[],
  D extends DependencyKind,
> = ArrayIncludes<Deps, D>;

// ========================================
// Method interfaces for each dependency
// ========================================

export interface TailorDBProcessMethods<T, Ts> {
  processType(args: {
    type: ParsedTailorDBType;
    namespace: string;
    source: { filePath: string; exportName: string };
  }): T | Promise<T>;

  processTailorDBNamespace?(args: {
    namespace: string;
    types: Record<string, T>;
  }): Ts | Promise<Ts>;
}

export interface ResolverProcessMethods<R, Rs> {
  processResolver(args: { resolver: Resolver; namespace: string }): R | Promise<R>;

  processResolverNamespace?(args: {
    namespace: string;
    resolvers: Record<string, R>;
  }): Rs | Promise<Rs>;
}

export interface ExecutorProcessMethods<E> {
  processExecutor(executor: Executor): E | Promise<E>;
}

// ========================================
// Conditional method selection
// ========================================

type SelectMethods<Deps extends readonly DependencyKind[], T, R, E, Ts, Rs> = (HasDependency<
  Deps,
  "tailordb"
> extends true
  ? TailorDBProcessMethods<T, Ts>
  : object) &
  (HasDependency<Deps, "resolver"> extends true ? ResolverProcessMethods<R, Rs> : object) &
  (HasDependency<Deps, "executor"> extends true ? ExecutorProcessMethods<E> : object);

// ========================================
// Conditional input selection for aggregate
// ========================================

interface TailorDBInputPart<Ts> {
  tailordb: TailorDBNamespaceResult<Ts>[];
}

interface ResolverInputPart<Rs> {
  resolver: ResolverNamespaceResult<Rs>[];
}

interface ExecutorInputPart<E> {
  executor: E[];
}

// Auth is always available (resolved after TailorDB, before generators)
interface AuthPart {
  auth?: GeneratorAuthInput;
}

type SelectInput<Deps extends readonly DependencyKind[], Ts, Rs, E> = (HasDependency<
  Deps,
  "tailordb"
> extends true
  ? TailorDBInputPart<Ts>
  : object) &
  (HasDependency<Deps, "resolver"> extends true ? ResolverInputPart<Rs> : object) &
  (HasDependency<Deps, "executor"> extends true ? ExecutorInputPart<E> : object) &
  AuthPart;

/** Input type for TailorDB-only generators */
export type TailorDBInput<Ts> = TailorDBInputPart<Ts> & AuthPart;

/** Input type for Resolver-only generators */
export type ResolverInput<Rs> = ResolverInputPart<Rs> & AuthPart;

/** Input type for Executor-only generators */
export type ExecutorInput<E> = ExecutorInputPart<E> & AuthPart;

/** Input type for full generators (TailorDB + Resolver + Executor) */
export type FullInput<Ts, Rs, E> = TailorDBInputPart<Ts> &
  ResolverInputPart<Rs> &
  ExecutorInputPart<E> &
  AuthPart;

/** Arguments type for aggregate method */
export interface AggregateArgs<Input> {
  input: Input;
  baseDir: string;
  configPath: string;
}

// ========================================
// CodeGenerator type definition
// ========================================

interface CodeGeneratorCore {
  readonly id: string;
  readonly description: string;
}

/**
 * Generator interface with dependencies-based conditional methods.
 * @template Deps - Dependencies array (e.g., ['tailordb'], ['tailordb', 'resolver'])
 * @template T - Return type of processType
 * @template R - Return type of processResolver
 * @template E - Return type of processExecutor
 * @template Ts - Return type of processTailorDBNamespace (default: Record<string, T>)
 * @template Rs - Return type of processResolverNamespace (default: Record<string, R>)
 */
export type CodeGenerator<
  Deps extends readonly DependencyKind[],
  T = unknown,
  R = unknown,
  E = unknown,
  Ts = Record<string, T>,
  Rs = Record<string, R>,
> = CodeGeneratorCore &
  SelectMethods<Deps, T, R, E, Ts, Rs> & {
    readonly dependencies: Deps;

    aggregate(args: {
      input: SelectInput<Deps, Ts, Rs, E>;
      baseDir: string;
      configPath: string;
    }): GeneratorResult | Promise<GeneratorResult>;
  };

// ========================================
// Helper types for common generator patterns
// ========================================

/** TailorDB-only generator */
export type TailorDBGenerator<T = unknown, Ts = Record<string, T>> = CodeGenerator<
  readonly ["tailordb"],
  T,
  never,
  never,
  Ts,
  never
>;

/** Resolver-only generator */
export type ResolverGenerator<R = unknown, Rs = Record<string, R>> = CodeGenerator<
  readonly ["resolver"],
  never,
  R,
  never,
  never,
  Rs
>;

/** Executor-only generator */
export type ExecutorGenerator<E = unknown> = CodeGenerator<
  readonly ["executor"],
  never,
  never,
  E,
  never,
  never
>;

/** TailorDB + Resolver generator */
export type TailorDBResolverGenerator<
  T = unknown,
  R = unknown,
  Ts = Record<string, T>,
  Rs = Record<string, R>,
> = CodeGenerator<readonly ["tailordb", "resolver"], T, R, never, Ts, Rs>;

/** Full generator (all dependencies) */
export type FullCodeGenerator<
  T = unknown,
  R = unknown,
  E = unknown,
  Ts = Record<string, T>,
  Rs = Record<string, R>,
> = CodeGenerator<readonly ["tailordb", "resolver", "executor"], T, R, E, Ts, Rs>;

// ========================================
// Runtime utility
// ========================================

/**
 * Type guard to check if a generator has a specific dependency.
 * @template D
 * @param {{ dependencies: readonly DependencyKind[] }} generator - Code generator instance
 * @param {readonly DependencyKind[]} generator.dependencies - Generator dependencies
 * @param {D} dependency - Dependency kind to check
 * @returns {boolean} True if the generator has the dependency
 */
export function hasDependency<D extends DependencyKind>(
  generator: { dependencies: readonly DependencyKind[] },
  dependency: D,
): boolean {
  return generator.dependencies.includes(dependency);
}

// Type for any generator (used in GenerationManager)
// This is a more permissive type that includes all possible methods
export interface AnyCodeGenerator {
  readonly id: string;
  readonly description: string;
  readonly dependencies: readonly DependencyKind[];

  processType?(args: {
    type: ParsedTailorDBType;
    namespace: string;
    source: { filePath: string; exportName: string };
  }): unknown | Promise<unknown>;

  processTailorDBNamespace?(args: {
    namespace: string;
    types: Record<string, unknown>;
  }): unknown | Promise<unknown>;

  processResolver?(args: { resolver: Resolver; namespace: string }): unknown | Promise<unknown>;

  processResolverNamespace?(args: {
    namespace: string;
    resolvers: Record<string, unknown>;
  }): unknown | Promise<unknown>;

  processExecutor?(executor: Executor): unknown | Promise<unknown>;

  aggregate(args: {
    input: Record<string, unknown>;
    baseDir: string;
    configPath: string;
  }): GeneratorResult | Promise<GeneratorResult>;
}
