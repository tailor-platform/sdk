namespace X {
  import tailor = localTailor;

  export const client = new tailor.idp.Client({ namespace: "default" });
}
