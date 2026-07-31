const result = await executeScript({
  client,
  workspaceId,
  name: "seed.ts",
  code: bundledCode,
  arg: { users: rows },
  invoker,
});
