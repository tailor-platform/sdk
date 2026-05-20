import { t } from "@/configure/types/type";
import { brandValue } from "@/utils/brand";
import {
  type ResolverFieldEntry,
  type ResolverFieldDescriptor,
  type ResolvedResolverFieldMap,
  type ResolverDescriptorOutput,
  type KindToFieldType,
  isResolverFieldDescriptor,
  resolveResolverFieldMap,
  resolveResolverField,
} from "./descriptor";
import type { AuthInvoker } from "@/configure/services/auth";
import type { MachineUserName } from "@/configure/types/machine-user";
import type { TailorAnyField, TailorField } from "@/configure/types/type";
import type { TailorEnv } from "@/types/env";
import type { TailorFieldType } from "@/types/field-types";
import type { InferFieldsOutput, output } from "@/types/helpers";
import type { ResolverInput } from "@/types/resolver.generated";
import type { TailorInvoker, TailorUser } from "@/types/user";

type ResolvedInput<Input> =
  Input extends Record<string, ResolverFieldEntry> ? ResolvedResolverFieldMap<Input> : undefined;

type Context<Input> = {
  input: Input extends Record<string, ResolverFieldEntry>
    ? InferFieldsOutput<ResolvedResolverFieldMap<Input>>
    : never;
  user: TailorUser;
  invoker?: TailorInvoker;
  env: TailorEnv;
};

type OutputType<O> = O extends TailorAnyField
  ? output<O>
  : O extends ResolverFieldDescriptor
    ? ResolverDescriptorOutput<O>
    : O extends Record<string, ResolverFieldEntry>
      ? InferFieldsOutput<ResolvedResolverFieldMap<O>>
      : never;

/**
 * Normalized output type that preserves generic type information.
 * - If Output is already a TailorField, use it as-is
 * - If Output is a descriptor, resolve it to a TailorField
 * - If Output is a Record of fields, wrap it as a nested TailorField
 */
type NormalizedOutput<Output> = Output extends TailorAnyField
  ? Output
  : Output extends ResolverFieldDescriptor
    ? TailorField<
        {
          type: Output["kind"] extends keyof KindToFieldType
            ? KindToFieldType[Output["kind"]]
            : TailorFieldType;
          array: Output extends { array: true } ? true : false;
        },
        ResolverDescriptorOutput<Output>
      >
    : TailorField<
        { type: "nested"; array: false },
        InferFieldsOutput<
          ResolvedResolverFieldMap<Extract<Output, Record<string, ResolverFieldEntry>>>
        >
      >;

type ResolverReturn<Input, Output> = Omit<
  ResolverInput,
  "input" | "output" | "body" | "authInvoker"
> &
  Readonly<{
    input?: ResolvedInput<Input>;
    output: NormalizedOutput<Output>;
    body: (context: Context<Input>) => OutputType<Output> | Promise<OutputType<Output>>;
    authInvoker?: AuthInvoker<string> | MachineUserName;
  }>;

/**
 * Create a resolver definition for the Tailor SDK.
 *
 * The `body` function receives a context with `input` (typed from `config.input`),
 * `user`, `invoker` (reflects `authInvoker` delegation), and `env`.
 * The return value of `body` must match the `output` type.
 *
 * `input` and `output` fields accept either fluent API fields (e.g. `t.string()`)
 * or object-literal descriptors (e.g. `{ kind: "string" }`). Both styles can be mixed.
 *
 * `output` accepts either a single field (fluent or descriptor), or a
 * Record of fields (e.g. `{ name: t.string(), age: { kind: "int" } }`).
 *
 * `publishEvents` enables publishing execution events for this resolver.
 * If not specified, this is automatically set to true when an executor uses this resolver
 * with `resolverExecutedTrigger`. If explicitly set to false while an executor uses this
 * resolver, an error will be thrown during apply.
 * @template Input
 * @template Output
 * @param config - Resolver configuration
 * @returns Normalized resolver configuration
 * @example
 * import { createResolver, t } from "@tailor-platform/sdk";
 *
 * // Fluent API style
 * export default createResolver({
 *   name: "getUser",
 *   operation: "query",
 *   input: {
 *     id: t.string(),
 *   },
 *   body: async ({ input }) => ({ name: "Alice" }),
 *   output: t.object({ name: t.string() }),
 * });
 *
 * // Object-literal descriptor style
 * export default createResolver({
 *   name: "add",
 *   operation: "query",
 *   input: {
 *     a: { kind: "int", description: "First number" },
 *     b: { kind: "int", description: "Second number" },
 *   },
 *   body: ({ input }) => input.a + input.b,
 *   output: { kind: "int", description: "Sum" },
 * });
 */
/* @__NO_SIDE_EFFECTS__ */
export function createResolver<
  Input extends Record<string, ResolverFieldEntry> | undefined = undefined,
  Output extends TailorAnyField | ResolverFieldDescriptor | Record<string, ResolverFieldEntry> =
    | TailorAnyField
    | ResolverFieldDescriptor,
>(
  config: Omit<ResolverInput, "input" | "output" | "body" | "authInvoker"> &
    Readonly<{
      input?: Input;
      output: Output;
      body: (context: Context<Input>) => OutputType<Output> | Promise<OutputType<Output>>;
      authInvoker?: AuthInvoker<string> | MachineUserName;
    }>,
): ResolverReturn<Input, Output> {
  const resolvedInput = config.input
    ? resolveResolverFieldMap(config.input as Record<string, ResolverFieldEntry>)
    : undefined;
  const normalizedOutput = resolveOutput(config.output);

  return brandValue(
    {
      ...config,
      input: resolvedInput,
      output: normalizedOutput,
    } as ResolverReturn<Input, Output>,
    "resolver",
  );
}

function isTailorField(obj: unknown): obj is TailorAnyField {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "type" in obj &&
    typeof (obj as { type: unknown }).type === "string"
  );
}

function resolveOutput(
  output: TailorAnyField | ResolverFieldDescriptor | Record<string, ResolverFieldEntry>,
): TailorAnyField {
  if (isResolverFieldDescriptor(output as ResolverFieldEntry)) {
    return resolveResolverField(output as ResolverFieldDescriptor);
  }

  if (isTailorField(output)) {
    return output;
  }

  const resolvedFields = resolveResolverFieldMap(output as Record<string, ResolverFieldEntry>);
  return t.object(resolvedFields);
}

// A loose config alias for userland use-cases
// oxlint-disable-next-line no-explicit-any
export type ResolverConfig = ReturnType<typeof createResolver<any, any>>;
