import type { AttributeMap, InferredAttributeMap, UserAttributeMap } from "@tailor-platform/sdk";

type AuthAttributes = AttributeMap;
type User = UserAttributeMap;
type Inferred = InferredAttributeMap<"auth">;
