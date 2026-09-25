const result = await executeScript({
  client,
  workspaceId,
  name: "seed.ts",
  code: bundledCode,
  arg: JSON.stringify({ users: rows }),
  invoker,
});
