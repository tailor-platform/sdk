
import {
  queryResolver,
  sqlStep,
  InputType,
  InputTypeField,
  Type,
  TypeField,
  ArrayOf
} from '@tailor-platform/tailor-sdk';
import { SalesOrder } from '../tailordb/salesOrder';

@InputType()
class OrderSummaryInput {
  @InputTypeField()
  public order_id?: number;
}

@Type()
class OrderSummaryOutput {
  @TypeField() @ArrayOf(SalesOrder)
  connection?: SalesOrder[];
}

const orderSummary = queryResolver("orderSummary",
  sqlStep(
    'orderSummary',
    "attendance-db",
    'SELECT id, email FROM Employee where id = $ORDER_ID',
    OrderSummaryInput, OrderSummaryOutput
  ),
);

export default orderSummary;
