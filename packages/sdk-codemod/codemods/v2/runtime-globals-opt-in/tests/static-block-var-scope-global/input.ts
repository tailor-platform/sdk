class Local {
  static {
    var tailor = { value: 1 };
    tailor.value;
  }
}

const client = new tailor.idp.Client();

export { Local, client };
