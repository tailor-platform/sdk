const category = db.table("Category", {
  parentID: db.uuid().relation({
    type: "n-1",
    toward: { type: "self" },
  }),
});
