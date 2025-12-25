/**
 * Resolver Basic Input/Output Performance Test
 *
 * Tests type inference cost for basic resolver input/output definitions
 * Uses query operation only to ensure consistent comparison
 */
import { createResolver, t } from "../../../src/configure";

export const resolver0 = createResolver({
  name: "resolver0",
  operation: "query",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => ({
    id: context.input.id,
    name: context.input.name,
    processed: true,
  }),
  output: t.object({
    id: t.string(),
    name: t.string(),
    processed: t.bool(),
  }),
});

export const resolver1 = createResolver({
  name: "resolver1",
  operation: "query",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => ({
    id: context.input.id,
    name: context.input.name,
    processed: true,
  }),
  output: t.object({
    id: t.string(),
    name: t.string(),
    processed: t.bool(),
  }),
});

export const resolver2 = createResolver({
  name: "resolver2",
  operation: "query",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => ({
    id: context.input.id,
    name: context.input.name,
    processed: true,
  }),
  output: t.object({
    id: t.string(),
    name: t.string(),
    processed: t.bool(),
  }),
});

export const resolver3 = createResolver({
  name: "resolver3",
  operation: "query",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => ({
    id: context.input.id,
    name: context.input.name,
    processed: true,
  }),
  output: t.object({
    id: t.string(),
    name: t.string(),
    processed: t.bool(),
  }),
});

export const resolver4 = createResolver({
  name: "resolver4",
  operation: "query",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => ({
    id: context.input.id,
    name: context.input.name,
    processed: true,
  }),
  output: t.object({
    id: t.string(),
    name: t.string(),
    processed: t.bool(),
  }),
});

export const resolver5 = createResolver({
  name: "resolver5",
  operation: "query",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => ({
    id: context.input.id,
    name: context.input.name,
    processed: true,
  }),
  output: t.object({
    id: t.string(),
    name: t.string(),
    processed: t.bool(),
  }),
});

export const resolver6 = createResolver({
  name: "resolver6",
  operation: "query",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => ({
    id: context.input.id,
    name: context.input.name,
    processed: true,
  }),
  output: t.object({
    id: t.string(),
    name: t.string(),
    processed: t.bool(),
  }),
});

export const resolver7 = createResolver({
  name: "resolver7",
  operation: "query",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => ({
    id: context.input.id,
    name: context.input.name,
    processed: true,
  }),
  output: t.object({
    id: t.string(),
    name: t.string(),
    processed: t.bool(),
  }),
});

export const resolver8 = createResolver({
  name: "resolver8",
  operation: "query",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => ({
    id: context.input.id,
    name: context.input.name,
    processed: true,
  }),
  output: t.object({
    id: t.string(),
    name: t.string(),
    processed: t.bool(),
  }),
});

export const resolver9 = createResolver({
  name: "resolver9",
  operation: "query",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => ({
    id: context.input.id,
    name: context.input.name,
    processed: true,
  }),
  output: t.object({
    id: t.string(),
    name: t.string(),
    processed: t.bool(),
  }),
});
