// Interface for module augmentation
// Users can extend via: declare module "@tailor-platform/sdk" { interface AIGatewayNameRegistry { ... } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AIGatewayNameRegistry {}

/**
 * AI Gateway name.
 *
 * When `tailor.d.ts` is generated (via `tailor deploy`/`generate`), this is narrowed
 * to the union of AI Gateway names defined via `defineAIGateway()`. Falls back to
 * `string` before the first generate run.
 */
export type AIGatewayName = keyof AIGatewayNameRegistry extends never
  ? string
  : keyof AIGatewayNameRegistry & string;
