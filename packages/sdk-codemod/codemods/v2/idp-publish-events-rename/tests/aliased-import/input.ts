import { defineIdp as makeIdp } from "@tailor-platform/sdk";

export const idp = makeIdp("my-idp", { clients: ["c"], publishUserEvents: false });
