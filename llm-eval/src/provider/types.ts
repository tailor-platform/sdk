export type GenerateInput = {
  prompt: string;
  docsContext: string;
  /** Path to the variant SDK dist (informational; passed to providers
   * that may want to attach as context). */
  sdkPath: string;
  /** Hard cap on output length. Defaults are provider-specific. */
  maxOutputTokens?: number;
};

export type GenerateOutput = {
  rawResponse: string;
  tokens: { in: number; out: number };
};

export interface Provider {
  /** Provider identifier — used as the `model` axis in the matrix. */
  readonly id: string;
  generate(input: GenerateInput): Promise<GenerateOutput>;
}
