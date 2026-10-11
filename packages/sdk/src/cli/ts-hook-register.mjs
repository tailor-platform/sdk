// Preloaded with `node --import` so a child Node.js process imports TypeScript
// the way the CLI does.
import { registerHooks } from "node:module";
import { loadSync, resolveSync } from "./ts-hook.mjs";

registerHooks({ resolve: resolveSync, load: loadSync });
