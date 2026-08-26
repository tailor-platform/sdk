const type = customer;
const order = db.table("Order", {
  customerId: db.uuid().relation({
    type: "n-1",
    toward: { type },
  }),
});
