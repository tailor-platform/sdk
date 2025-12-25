/**
 * Resolver Array Types Performance Test
 *
 * Tests type inference cost for array types in input/output
 */
import { createResolver, t } from "../../../src/configure";

export const resolver0 = createResolver({
  name: "resolver0",
  operation: "query",
  input: {
    ids: t.string({ array: true }),
    filters: t.object(
      {
        field: t.string(),
        value: t.string(),
      },
      { array: true },
    ),
  },
  body: async (context) => ({
    items: context.input.ids.map((id) => ({ id, name: "item" })),
    count: context.input.ids.length,
  }),
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});

export const resolver1 = createResolver({
  name: "resolver1",
  operation: "query",
  input: {
    ids: t.string({ array: true }),
    filters: t.object(
      {
        field: t.string(),
        value: t.string(),
      },
      { array: true },
    ),
  },
  body: async (context) => ({
    items: context.input.ids.map((id) => ({ id, name: "item" })),
    count: context.input.ids.length,
  }),
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});

export const resolver2 = createResolver({
  name: "resolver2",
  operation: "query",
  input: {
    ids: t.string({ array: true }),
    filters: t.object(
      {
        field: t.string(),
        value: t.string(),
      },
      { array: true },
    ),
  },
  body: async (context) => ({
    items: context.input.ids.map((id) => ({ id, name: "item" })),
    count: context.input.ids.length,
  }),
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});

export const resolver3 = createResolver({
  name: "resolver3",
  operation: "query",
  input: {
    ids: t.string({ array: true }),
    filters: t.object(
      {
        field: t.string(),
        value: t.string(),
      },
      { array: true },
    ),
  },
  body: async (context) => ({
    items: context.input.ids.map((id) => ({ id, name: "item" })),
    count: context.input.ids.length,
  }),
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});

export const resolver4 = createResolver({
  name: "resolver4",
  operation: "query",
  input: {
    ids: t.string({ array: true }),
    filters: t.object(
      {
        field: t.string(),
        value: t.string(),
      },
      { array: true },
    ),
  },
  body: async (context) => ({
    items: context.input.ids.map((id) => ({ id, name: "item" })),
    count: context.input.ids.length,
  }),
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});

export const resolver5 = createResolver({
  name: "resolver5",
  operation: "query",
  input: {
    ids: t.string({ array: true }),
    filters: t.object(
      {
        field: t.string(),
        value: t.string(),
      },
      { array: true },
    ),
  },
  body: async (context) => ({
    items: context.input.ids.map((id) => ({ id, name: "item" })),
    count: context.input.ids.length,
  }),
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});

export const resolver6 = createResolver({
  name: "resolver6",
  operation: "query",
  input: {
    ids: t.string({ array: true }),
    filters: t.object(
      {
        field: t.string(),
        value: t.string(),
      },
      { array: true },
    ),
  },
  body: async (context) => ({
    items: context.input.ids.map((id) => ({ id, name: "item" })),
    count: context.input.ids.length,
  }),
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});

export const resolver7 = createResolver({
  name: "resolver7",
  operation: "query",
  input: {
    ids: t.string({ array: true }),
    filters: t.object(
      {
        field: t.string(),
        value: t.string(),
      },
      { array: true },
    ),
  },
  body: async (context) => ({
    items: context.input.ids.map((id) => ({ id, name: "item" })),
    count: context.input.ids.length,
  }),
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});

export const resolver8 = createResolver({
  name: "resolver8",
  operation: "query",
  input: {
    ids: t.string({ array: true }),
    filters: t.object(
      {
        field: t.string(),
        value: t.string(),
      },
      { array: true },
    ),
  },
  body: async (context) => ({
    items: context.input.ids.map((id) => ({ id, name: "item" })),
    count: context.input.ids.length,
  }),
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});

export const resolver9 = createResolver({
  name: "resolver9",
  operation: "query",
  input: {
    ids: t.string({ array: true }),
    filters: t.object(
      {
        field: t.string(),
        value: t.string(),
      },
      { array: true },
    ),
  },
  body: async (context) => ({
    items: context.input.ids.map((id) => ({ id, name: "item" })),
    count: context.input.ids.length,
  }),
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});
