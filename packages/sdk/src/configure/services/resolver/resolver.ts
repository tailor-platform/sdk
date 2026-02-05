import { t } from "@/configure/types/type";
import type { TailorDBType, TailorAnyDBField } from "@/configure/services/tailordb/schema";
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
> = Omit<ResolverInput, "input" | "output" | "body"> &
  Readonly<{
    input?: Input;
    output: NormalizedOutput<Output>;
    body: (context: Context<Input>) => OutputType<Output> | Promise<OutputType<Output>>;
  }>;

/**
 * Create a resolver definition for the Tailor SDK.
 * @template Input
 * @template Output
 * @param config - Resolver configuration
 * @returns Normalized resolver configuration
 */
export function createResolver<
  Input extends Record<string, TailorAnyField> | undefined = undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField> = TailorAnyField,
>(
  config: Omit<ResolverInput, "input" | "output" | "body"> &
    Readonly<{
      input?: Input;
      output: Output;
      body: (context: Context<Input>) => OutputType<Output> | Promise<OutputType<Output>>;
    }>,
): ResolverReturn<Input, Output> {
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

// A loose config alias for userland use-cases
// oxlint-disable-next-line no-explicit-any
export type ResolverConfig = ReturnType<typeof createResolver<any, any>>;

/**
 * Convert a TailorDBType to a TailorField for use as resolver output.
 * Equivalent to: t.object(type.fields).typeName(type.name)
 * @param type - The TailorDBType to convert
 * @returns A TailorField with the type's fields and name as typeName
 */
export function toResolverOutput<Fields extends Record<string, TailorAnyDBField>>(
  type: TailorDBType<Fields>,
): TailorField<{ type: "nested"; array: false; typeName: true }, InferFieldsOutput<Fields>> {
  return t.object(type.fields).typeName(type.name) as TailorField<
    { type: "nested"; array: false; typeName: true },
    InferFieldsOutput<Fields>
  >;
}
