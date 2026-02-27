import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "auditAction",
  description: "Audit logging with role-based access control",
  operation: "mutation",
  input: {
    action: t.string(),
    targetId: t.string(),
    reason: t.string({ optional: true }),
  },
  body: ({ input, user }) => {
    const role = user.attributes?.role as string | undefined;
    if (role !== "admin" && role !== "auditor") {
      return {
        success: false,
        message: `Access denied: role '${role ?? "unknown"}' is not authorized`,
      };
    }
    return {
      success: true,
      message: `Audit logged: ${input.action} on ${input.targetId} by ${user.id}`,
      auditEntry: {
        userId: user.id,
        action: input.action,
        targetId: input.targetId,
        reason: input.reason ?? "No reason provided",
        timestamp: new Date().toISOString(),
      },
    };
  },
  output: t.object({
    success: t.bool(),
    message: t.string(),
    auditEntry: t.object(
      {
        userId: t.string(),
        action: t.string(),
        targetId: t.string(),
        reason: t.string(),
        timestamp: t.string(),
      },
      { optional: true },
    ),
  }),
});
