import { Executor } from "./types";

export function isExecutor(obj: any): obj is Executor {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.name === "string" &&
    typeof obj.exec === "object" &&
    typeof obj.trigger === "object"
  );
}
