import { auth } from "../tailor.config";

{
  class auth {}

  const token = auth.getConnectionToken("google");
}
