import { createWorkflow } from "@tailor-platform/sdk";
import { onboardUser, setupAccount, assignDefaults } from "./onboardingJobs";

export { onboardUser, setupAccount, assignDefaults };

export default createWorkflow({
  name: "user-onboarding",
  mainJob: onboardUser,
});
