import { z } from "zod";

export const ProbeSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "cold-read",
    "hallucination",
    "name-redaction",
    "wrong-way",
    "e2e",
    "migration",
  ]),
  targetApis: z.array(z.string()).default([]),
  prompt: z.string().min(1),
  expectedSymbols: z.record(z.string(), z.array(z.string())).optional(),
  checks: z
    .array(z.enum(["imports", "typecheck", "halluc", "patterns", "ast-distance"]))
    .default(["imports", "halluc", "patterns"]),
  e2e: z
    .object({
      testFile: z.string(),
      setupFiles: z.array(z.string()).default([]),
    })
    .optional(),
});

export type ProbeInput = z.infer<typeof ProbeSchema>;
