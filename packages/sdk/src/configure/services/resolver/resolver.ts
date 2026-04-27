import { t } from "@/configure/types/type";
import { brandValue } from "@/utils/brand";
import type { AuthInvoker } from "@/configure/services/auth";
import type { MachineUserName } from "@/configure/types/machine-user";
import type { TailorAnyField, TailorField } from "@/configure/types/type";
import type { TailorEnv } from "@/types/env";
import type { InferFieldsOutput, output } from "@/types/helpers";
import type { ResolverInput } from "@/types/resolver.generated";
import type { TailorInvoker, TailorUser } from "@/types/user";

type Context<Input extends Record<string, TailorAnyField> | undefined> = {
  input: Input extends Record<string, TailorAnyField> ? InferFieldsOutput<Input> : never;
  user: TailorUser;
  invoker?: TailorInvoker;
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
> = Omit<ResolverInput, "input" | "output" | "body" | "authInvoker"> &
  Readonly<{
    input?: Input;
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
 * `output` accepts either a single TailorField (e.g. `t.string()`) or a
 * Record of fields (e.g. `{ name: t.string(), age: t.int() }`).
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
 * export default createResolver({
 *   name: "getUser",
 *   operation: "query",
 *   input: {
 *     id: t.string(),
 *   },
 *   body: async ({ input, user }) => {
 *     const db = getDB("tailordb");
 *     const result = await db.selectFrom("User").selectAll().where("id", "=", input.id).executeTakeFirst();
 *     return { name: result?.name ?? "", email: result?.email ?? "" };
 *   },
 *   output: t.object({
 *     name: t.string(),
 *     email: t.string(),
 *   }),
 * });
 */
export function createResolver<
  Input extends Record<string, TailorAnyField> | undefined = undefined,
  Output extends TailorAnyField | Record<string, TailorAnyField> = TailorAnyField,
>(
  config: Omit<ResolverInput, "input" | "output" | "body" | "authInvoker"> &
    Readonly<{
      input?: Input;
      output: Output;
      body: (context: Context<Input>) => OutputType<Output> | Promise<OutputType<Output>>;
      authInvoker?: AuthInvoker<string> | MachineUserName;
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

  return brandValue(
    {
      ...config,
      output: normalizedOutput,
    } as ResolverReturn<Input, Output>,
    "resolver",
  );
}

// A loose config alias for userland use-cases
// oxlint-disable-next-line no-explicit-any
export type ResolverConfig = ReturnType<typeof createResolver<any, any>>;
