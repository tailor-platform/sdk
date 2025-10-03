import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";

//#region resolvers/userInfo/resolver.ts
var resolver_default = createQueryResolver("showUserInfo", t.type({ message: t.string() })).fnStep("step1", (context) => {
	return {
		message: context.input.message,
		userId: context.user.id,
		userType: context.user.type
	};
}).returns((context) => ({
	message: context.step1.message,
	userId: context.step1.userId,
	userType: context.step1.userType
}), t.type({
	message: t.string(),
	userId: t.string(),
	userType: t.string()
}));

//#endregion
export { resolver_default as default };

export const $tailor_resolver_step__step1 = (context) => {
	return {
		message: context.input.message,
		userId: context.user.id,
		userType: context.user.type
	};
};
