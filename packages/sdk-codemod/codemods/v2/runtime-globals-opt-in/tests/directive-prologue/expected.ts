"use server";
import { idp } from "@tailor-platform/sdk/runtime";

export const client = new idp.Client({ namespace: "default" });
