import { aigateway } from "@tailor-platform/sdk/runtime/aigateway";

const gateway = aigateway.get("main");
const element = (
  <get data-id="main">
    <get />
  </get>
);
