import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";
import { format } from "date-fns";
import { step1 } from "./step1";

const step3 = async ({ context }: any) => ({
  step1: context.step1,
  step2: context.step2,
  step3: "summarized step1 and step2",
});

const input = t.type("stepChainInput", {
  name: t.string(),
});
const resolver = createQueryResolver("stepChain", input)
  .fnStep("step1", step1)
  .fnStep(
    "step2",
    async () =>
      `step2: recorded ${format(new Date(), "yyyy-MM-dd HH:mm:ss")} on step2!`,
  )
  .fnStep("step3", step3);

const output = t.type("stepChainOutput", {
  step1: t.string(),
  step2: t.string(),
  step3: t.string(),
});

export default resolver.returns(output);
