import { t } from "@/configure/types/type";
import type { TailorAnyField, TailorUser } from "@/configure/types";
import type { TailorEnv } from "@/configure/types/env";
import type { InferFieldsOutput, output } from "@/configure/types/helpers";
import type { TailorField } from "@/configure/types/type";
import type { ResolverInput } from "@/parser/service/resolver/types";

type Context<Input extends Record<string, TailorAnyField> | undefined> = {
  input: Input extends Record<string, TailorAnyField> ? InferFieldsOutput<Input> : never;
  user: TailorUser;
  env: TailorEnv;
};

type OutputType<O> = O extends TailorAnyField
  ? output<O>
  : O extends Record<string, TailorAnyField>
    ? InferFieldsOutput<O>
    : never;

/**
 * Normalized output type that preserves generic type information.
 * - If Output is already a TailorField, use it as-is
 * - If Output is a Record of fields, wrap it as a nested TailorField
 */
type NormalizedOutput<Output extends TailorAnyField | Record<string, TailorAnyField>> =
  Output extends TailorAnyField
    ? Output
    : TailorField<
        { type: "nested"; array: false },
        InferFieldsOutput<Extract<Output, Record<string, TailorAnyField>>>
      >;

type ResolverReturn<
  Input extends Record<string, TailorAnyField> | undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField>,
> = Omit<ResolverInput, "input" | "output" | "body" | "scriptRef"> &
  Readonly<{
    input?: Input;
    output: NormalizedOutput<Output>;
    body: (context: Context<Input>) => OutputType<Output> | Promise<OutputType<Output>>;
  }>;

/**
 * Resolver return type with Function Registry reference.
 * Does not include body function since scriptRef references external function.
 */
export type ResolverReturnWithScriptRef<
  Input extends Record<string, TailorAnyField> | undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField>,
> = Omit<ResolverInput, "input" | "output" | "body" | "scriptRef"> &
  Readonly<{
    input?: Input;
    output: NormalizedOutput<Output>;
    scriptRef: string;
  }>;

type ResolverConfigWithBody<
  Input extends Record<string, TailorAnyField> | undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField>,
> = Omit<ResolverInput, "input" | "output" | "body" | "scriptRef"> &
  Readonly<{
    input?: Input;
    output: Output;
    body: (context: Context<Input>) => OutputType<Output> | Promise<OutputType<Output>>;
    scriptRef?: never;
  }>;

type ResolverConfigWithScriptRef<
  Input extends Record<string, TailorAnyField> | undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField>,
> = Omit<ResolverInput, "input" | "output" | "body" | "scriptRef"> &
  Readonly<{
    input?: Input;
    output: Output;
    body?: never;
    scriptRef: string;
  }>;

/**
 * Create a resolver definition for the Tailor SDK.
 * @template Input
 * @template Output
 * @param config - Resolver configuration with body function
 * @returns Normalized resolver configuration
 */
export function createResolver<
  Input extends Record<string, TailorAnyField> | undefined = undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField> = TailorAnyField,
>(config: ResolverConfigWithBody<Input, Output>): ResolverReturn<Input, Output>;

/**
 * Create a resolver definition with Function Registry reference.
 * @template Input
 * @template Output
 * @param config - Resolver configuration with scriptRef
 * @returns Normalized resolver configuration
 */
export function createResolver<
  Input extends Record<string, TailorAnyField> | undefined = undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField> = TailorAnyField,
>(config: ResolverConfigWithScriptRef<Input, Output>): ResolverReturnWithScriptRef<Input, Output>;

export function createResolver<
  Input extends Record<string, TailorAnyField> | undefined = undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField> = TailorAnyField,
>(
  config: ResolverConfigWithBody<Input, Output> | ResolverConfigWithScriptRef<Input, Output>,
): ResolverReturn<Input, Output> | ResolverReturnWithScriptRef<Input, Output> {
  // Check if output is already a TailorField using duck typing.
  // TailorField has `type: string` (e.g., "uuid", "string"), while
  // Record<string, TailorField> either lacks `type` or has TailorField as value.
  const isTailorField = (obj: unknown): obj is TailorAnyField =>
    typeof obj === "object" &&
    obj !== null &&
    "type" in obj &&
    typeof (obj as { type: unknown }).type === "string";

  const normalizedOutput = isTailorField(config.output) ? config.output : t.object(config.output);

  return {
    ...config,
    output: normalizedOutput,
  } as ResolverReturn<Input, Output>;
}

// A loose config alias for userland use-cases (only for resolvers with body)
// oxlint-disable-next-line no-explicit-any
export type ResolverConfig = ResolverReturn<any, any>;
