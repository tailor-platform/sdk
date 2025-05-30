import url from "node:url";
import { Tailor } from '@tailor-platform/tailor-sdk';
import { SalesOrder } from './tailordb/salesOrder'
import { Customer } from './tailordb/customer'
import helloWorld from './resolvers/hello-world';
import orderSummary from './resolvers/order-summary';
import externalLib from './resolvers/external-lib';
import { supplier } from './tailordb/supplier';
import { purchaseOrder } from './tailordb/purchaseOrder';

const __filename = url.fileURLToPath(import.meta.url);

export async function apply() {
  Tailor.init(process.argv[2] || process.cwd());
  const workspace = Tailor.newWorkspace('my_workspace');

  const tailorDB = workspace.newTailorDBservice('my_db');
  tailorDB.addTailorDBType(SalesOrder);
  tailorDB.addTailorDBType(Customer);
  tailorDB.addTailorDBType(supplier);
  tailorDB.addTailorDBType(purchaseOrder);

  const resolver = workspace.newResolverService('my_pipeline');
  resolver.addResolver(helloWorld);
  resolver.addResolver(orderSummary);
  resolver.addResolver(externalLib);
  resolver.build();

  workspace.newApplication('my_app');
  await workspace.apply();
}

if (process.argv[1] === __filename) {
  await apply().catch(console.error);
}
