export type DocsPreset =
  | "bare"
  | "jsdoc"
  | "docsOnly"
  | "skillsOnly"
  | "inPackage"
  | "full"
  | "predicted";

export type DocsCondition = {
  preset: DocsPreset;
  jsdoc: boolean;
  packageDocs: boolean;
  agentFiles: boolean;
  externalDocs: boolean;
  llmsTxt: boolean;
  mcp: boolean;
};

export type Signal =
  | { type: "hallucinated_import"; path: string; symbol: string }
  | { type: "hallucinated_method"; receiver: string; method: string }
  | { type: "wrong_import_path"; path: string }
  | { type: "invented_factory"; symbol: string; actual: string }
  | { type: "parameter_order_swap"; call: string }
  | { type: "forgotten_await"; call: string }
  | { type: "positional_for_options"; call: string }
  | { type: "wrong_overload"; call: string }
  | { type: "typecheck_failure"; tsCodes: string[]; messages: string[] }
  | { type: "guess_comment"; line: number; text: string }
  | { type: "long_preamble"; charsBeforeCode: number };

export type Tag =
  | { kind: "OK" }
  | { kind: "CUTOFF"; gateLayer: "L2" | "L3" | "L4" | "L5" | "L6" | "L7" }
  | { kind: "DESIGN"; strength: number }
  | { kind: "IMPROVED_BY_VARIANT"; variant: string; deltaSignals: number }
  | { kind: "VIBE_GAP_HIGH"; astDistance: number };

export type ProbeCategory =
  | "cold-read"
  | "hallucination"
  | "name-redaction"
  | "wrong-way"
  | "e2e"
  | "migration";

export type CheckName = "imports" | "typecheck" | "halluc" | "patterns" | "ast-distance";

export type Probe = {
  id: string;
  category: ProbeCategory;
  targetApis: string[];
  prompt: string;
  expectedSymbols?: Record<string, string[]>;
  checks: CheckName[];
  e2e?: { testFile: string; setupFiles: string[] };
};

export type Cell = {
  probe: string;
  model: string;
  condition: DocsCondition;
  variant: string;
  /** 0-based index of the repeat run for this (probe, model, condition, variant). */
  repeatIndex: number;
  generatedCode: string;
  rawResponse: string;
  signals: Signal[];
  passed: boolean;
  tags: Tag[];
  tokens: { in: number; out: number };
  durationMs: number;
};
