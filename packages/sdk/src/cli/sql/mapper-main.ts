// The process TypeScript starts as the `.sql` content mapper (`typescript.contentMapper` in package.json).
import { registerTsHook } from "#/cli/shared/register-ts-hook";
import { observeLoadedFiles } from "./loaded-files";
import { createSqlMapperHandlers } from "./mapper";
import { serveJsonRpc } from "./rpc";

// stdout carries the protocol, so anything the project's own code prints goes to stderr.
const writeProtocol = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);

await registerTsHook(new URL("../ts-hook.mjs", import.meta.url));
observeLoadedFiles();
await serveJsonRpc(createSqlMapperHandlers(), process.stdin, (chunk) => writeProtocol(chunk));
