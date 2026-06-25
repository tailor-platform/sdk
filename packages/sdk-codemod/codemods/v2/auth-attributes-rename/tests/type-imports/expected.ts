import type { Attributes, InferredAttributes, UserAttributes } from "@tailor-platform/sdk";

type AuthAttributes = Attributes;
type User = UserAttributes;
type Inferred = InferredAttributes<"auth">;
