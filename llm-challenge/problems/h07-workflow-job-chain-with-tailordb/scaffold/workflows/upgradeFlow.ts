// Author three workflow jobs (loadAccount, computeUpgradeCost, processUpgrade)
// plus a default-exported createWorkflow named "upgrade-flow". loadAccount must
// read Account.tier via getDB("tailordb"); processUpgrade chains both child
// triggers with `await`. See problem.md for the full requirements.
