const serialized = JSON.stringify({ users: rows });
await executeScript({ client, workspaceId, code, arg: serialized, invoker });
