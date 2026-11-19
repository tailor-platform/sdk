import { describe, expectTypeOf, test } from "vitest";
import type { AppConfig, AppDefinition, EnvEntry, WorkspaceConfig } from "#/configure/config/types";
import type { AIGatewayServiceInput } from "#/configure/services/aigateway/types";
import type { AuthOwnConfig } from "#/configure/services/auth/types";
import type { Operation } from "#/configure/services/executor/operation";
import type { Trigger } from "#/configure/services/executor/trigger/index";
import type { HttpAdapter } from "#/configure/services/http-adapter/http-adapter";
import type { IdPOwnConfig } from "#/configure/services/idp/types";
import type { ResolverConfig } from "#/configure/services/resolver/resolver";
import type {
  DBFieldMetadata,
  RawRelationConfig,
  TailorDBTypeMetadata,
} from "#/configure/services/tailordb/types";
import type { ExecutionPolicyConcurrency } from "#/configure/services/workflow/execution-policy.types";
import type { Workflow, WorkflowJob } from "#/configure/services/workflow/index";
import type { FieldMetadata, TailorFieldType } from "#/configure/types/field.types";
import type { TailorDBFieldOutput } from "#/parser/service/tailordb/types";
import type { Plugin } from "#/plugin/types";
import type { AIGatewayInput } from "#/types/aigateway.generated";
import type {
  AppConfigParsedInput,
  AppDefinitionParsedInput,
  WorkspaceConfigParsedInput,
} from "#/types/app-config.generated";
import type { AuthConfigInput } from "#/types/auth.generated";
import type { OperationInput, TriggerInput } from "#/types/executor.generated";
import type { TailorFieldInput } from "#/types/field.generated";
import type { HttpAdapterConfigInput } from "#/types/http-adapter.generated";
import type { IdPInput } from "#/types/idp.generated";
import type { PluginConfigInput } from "#/types/plugin-config.generated";
import type { ResolverInput } from "#/types/resolver.generated";
import type {
  DBFieldMetadataInput,
  RawRelationConfigInput,
  TailorDBTypeRawInput,
} from "#/types/tailordb.generated";
import type {
  ConcurrencyPolicyInput,
  WorkflowInput,
  WorkflowJobInput,
} from "#/types/workflow.generated";
import type { ArrayElement, IsAny, IsEqual, KeysOfUnion, OmitIndexSignature } from "type-fest";

type ObjectMembers<S> = Exclude<
  S,
  string | number | boolean | bigint | symbol | null | undefined | readonly unknown[]
>;
type ValueAt<S, K extends PropertyKey> = S extends unknown
  ? K extends keyof S
    ? S[K]
    : string extends keyof S
      ? S[string & keyof S]
      : never
  : never;
// A configure union member is compared only with the schema members it is assignable to.
type MatchingMembers<C, S> = [S extends unknown ? (C extends S ? S : never) : never] extends [
  infer M,
]
  ? [M] extends [never]
    ? S
    : M
  : S;

/**
 * Dotted paths of the keys `C` declares and `S` lacks. Strict schemas reject
 * such keys, while `C extends S` ignores extra optional keys. `any` or
 * `unknown` on either side leaves that subtree unchecked, and a subtree that
 * differs from the schema's below eight levels is reported as a whole.
 */
type ExtraKeyPaths<C, S, Path extends string = "", Depth extends unknown[] = []> =
  IsAny<C> extends true
    ? never
    : IsAny<S> extends true
      ? never
      : unknown extends S
        ? never
        : IsEqual<C, NonNullable<S>> extends true
          ? never
          : // oxlint-disable-next-line typescript/no-unsafe-function-type
            C extends Function
            ? never
            : C extends object
              ? Depth["length"] extends 8
                ? `${Path} (deeper than 8 levels)`
                : C extends readonly (infer E)[]
                  ? ExtraKeyPaths<E, ArrayElement<NonNullable<S>>, `${Path}[]`, [...Depth, 0]>
                  : ObjectExtraKeyPaths<
                      C,
                      MatchingMembers<C, ObjectMembers<NonNullable<S>>>,
                      Path,
                      Depth
                    >
              : never;

type ObjectExtraKeyPaths<C, S, Path extends string, Depth extends unknown[]> = {
  [K in keyof C & string]-?: K extends KeysOfUnion<S>
    ? ExtraKeyPaths<NonNullable<C[K]>, ValueAt<S, K>, `${Path}.${K}`, [...Depth, 0]>
    : `${Path}.${K}`;
}[keyof C & string];

type WithoutTriggerArgs<T> = T extends unknown ? Omit<T, "__args"> : never;
// An interface never extends an index signature, such as the one of the loose `workflow` schema.
type WithWorkflowName<T> = T extends { workflow: Workflow }
  ? Omit<T, "workflow"> & { workflow: Pick<Workflow, "name"> }
  : T;

describe("ExtraKeyPaths", () => {
  test("reports a nested key the schema lacks", () => {
    expectTypeOf<
      ExtraKeyPaths<{ a: { b?: string; c?: string }[] }, { a: { b?: string }[] }>
    >().toEqualTypeOf<".a[].c">();
  });

  test("compares a union member only with the schema member it matches", () => {
    type Configure = { kind: "a"; extra?: string } | { kind: "b" };
    type Schema = { kind: "a" } | { kind: "b"; extra?: string };
    expectTypeOf<ExtraKeyPaths<Configure, Schema>>().toEqualTypeOf<".extra">();
  });

  test("leaves a value the schema takes as unknown unchecked", () => {
    expectTypeOf<ExtraKeyPaths<{ a: { b: string } }, { a?: unknown }>>().toEqualTypeOf<never>();
  });

  test("reports a differing subtree below eight levels instead of passing it", () => {
    type Nest<T> = { a: T };
    type Configure = Nest<Nest<Nest<Nest<Nest<Nest<Nest<Nest<Nest<{ b?: string }>>>>>>>>>;
    type Schema = Nest<Nest<Nest<Nest<Nest<Nest<Nest<Nest<Nest<object>>>>>>>>>;
    expectTypeOf<
      ExtraKeyPaths<Configure, Schema>
    >().toEqualTypeOf<".a.a.a.a.a.a.a.a (deeper than 8 levels)">();
  });
});

describe("configure input types are accepted by the schema that parses them", () => {
  test("defineConfig", () => {
    expectTypeOf<AppConfig>().toExtend<AppConfigParsedInput>();
    expectTypeOf<ExtraKeyPaths<AppConfig, AppConfigParsedInput>>().toEqualTypeOf<never>();
  });

  test("defineApp", () => {
    expectTypeOf<AppDefinition>().toExtend<AppDefinitionParsedInput>();
    expectTypeOf<ExtraKeyPaths<AppDefinition, AppDefinitionParsedInput>>().toEqualTypeOf<never>();
  });

  test("defineWorkspace", () => {
    type Configure = WorkspaceConfig<Record<string, EnvEntry>, string, string, string, string>;
    expectTypeOf<Configure>().toExtend<WorkspaceConfigParsedInput>();
    expectTypeOf<ExtraKeyPaths<Configure, WorkspaceConfigParsedInput>>().toEqualTypeOf<never>();
  });

  test("defineAuth", () => {
    expectTypeOf<AuthOwnConfig>().toExtend<AuthConfigInput>();
    expectTypeOf<ExtraKeyPaths<AuthOwnConfig, AuthConfigInput>>().toEqualTypeOf<never>();
  });

  test("defineIdp", () => {
    expectTypeOf<IdPOwnConfig>().toExtend<IdPInput>();
    expectTypeOf<ExtraKeyPaths<IdPOwnConfig, IdPInput>>().toEqualTypeOf<never>();
  });

  test("defineAIGateway", () => {
    expectTypeOf<AIGatewayServiceInput>().toExtend<AIGatewayInput>();
    expectTypeOf<ExtraKeyPaths<AIGatewayServiceInput, AIGatewayInput>>().toEqualTypeOf<never>();
  });

  test("db.table metadata", () => {
    type Parsed = TailorDBTypeRawInput["metadata"];
    expectTypeOf<TailorDBTypeMetadata>().toExtend<Parsed>();
    expectTypeOf<ExtraKeyPaths<TailorDBTypeMetadata, Parsed>>().toEqualTypeOf<never>();
  });

  test("db field metadata", () => {
    expectTypeOf<DBFieldMetadata>().toExtend<DBFieldMetadataInput>();
    expectTypeOf<ExtraKeyPaths<DBFieldMetadata, DBFieldMetadataInput>>().toEqualTypeOf<never>();
  });

  test("db field relation", () => {
    expectTypeOf<RawRelationConfig>().toExtend<RawRelationConfigInput>();
    expectTypeOf<ExtraKeyPaths<RawRelationConfig, RawRelationConfigInput>>().toEqualTypeOf<never>();
  });

  test("db fields used as resolver input/output or machine user attributes", () => {
    type Parsed = TailorFieldInput["metadata"];
    expectTypeOf<DBFieldMetadata>().toExtend<Parsed>();
    expectTypeOf<ExtraKeyPaths<DBFieldMetadata, Parsed>>().toEqualTypeOf<never>();
  });

  test("t field metadata", () => {
    type Parsed = TailorFieldInput["metadata"];
    expectTypeOf<FieldMetadata>().toExtend<Parsed>();
    expectTypeOf<ExtraKeyPaths<FieldMetadata, Parsed>>().toEqualTypeOf<never>();
  });

  test("createResolver", () => {
    expectTypeOf<ResolverConfig>().toExtend<ResolverInput>();
    expectTypeOf<ExtraKeyPaths<ResolverConfig, ResolverInput>>().toEqualTypeOf<never>();
  });

  test("createExecutor trigger", () => {
    type Configure = WithoutTriggerArgs<Trigger<unknown>>;
    expectTypeOf<Configure>().toExtend<TriggerInput>();
    expectTypeOf<ExtraKeyPaths<Configure, TriggerInput>>().toEqualTypeOf<never>();
  });

  test("createExecutor operation", () => {
    expectTypeOf<WithWorkflowName<Operation<unknown>>>().toExtend<OperationInput>();
    expectTypeOf<ExtraKeyPaths<Operation<unknown>, OperationInput>>().toEqualTypeOf<never>();
  });

  test("createWorkflow", () => {
    type Configure = Omit<Workflow, "start">;
    expectTypeOf<Configure>().toExtend<WorkflowInput>();
    expectTypeOf<ExtraKeyPaths<Configure, WorkflowInput>>().toEqualTypeOf<never>();
  });

  test("createWorkflowJob", () => {
    expectTypeOf<WorkflowJob>().toExtend<WorkflowJobInput>();
    expectTypeOf<ExtraKeyPaths<WorkflowJob, WorkflowJobInput>>().toEqualTypeOf<never>();
  });

  test("workflow execution policy concurrency", () => {
    expectTypeOf<ExecutionPolicyConcurrency>().toExtend<ConcurrencyPolicyInput>();
    expectTypeOf<
      ExtraKeyPaths<ExecutionPolicyConcurrency, ConcurrencyPolicyInput>
    >().toEqualTypeOf<never>();
  });

  test("createHttpAdapter", () => {
    expectTypeOf<HttpAdapter>().toExtend<HttpAdapterConfigInput>();
    expectTypeOf<ExtraKeyPaths<HttpAdapter, HttpAdapterConfigInput>>().toEqualTypeOf<never>();
  });

  test("definePlugins", () => {
    expectTypeOf<Plugin>().toExtend<OmitIndexSignature<PluginConfigInput>>();
  });
});

describe("TailorDBFieldOutput", () => {
  test("type lists the field types of TailorFieldType", () => {
    expectTypeOf<TailorDBFieldOutput["type"]>().toEqualTypeOf<TailorFieldType>();
  });
});
