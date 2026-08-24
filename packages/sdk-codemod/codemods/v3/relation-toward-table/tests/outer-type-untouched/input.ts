const field = { type: "uuid", relation: null };

const order = db.table("Order", {
  customerId: db.uuid().relation({
    type: "n-1",
    toward: { type: customer, as: "purchaser" },
  }),
});
