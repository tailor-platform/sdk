import { get } from "@tailor-platform/sdk/runtime/aigateway";

const gateway = get("main");
const element = (
  <get data-id="main">
    <get />
  </get>
);
