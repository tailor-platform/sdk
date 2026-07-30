import { defineIdp } from "@tailor-platform/sdk";

function wrap() {
  const defineIdp = (name: string, config: { publishUserEvents?: boolean }) => ({ name, config });
  return defineIdp("my-idp", { publishUserEvents: true });
}

export const wrapped = wrap();
