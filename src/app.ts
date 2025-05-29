import { Tailor } from '@tailor-platform/tailor-sdk';
import { SalesOrder } from './tailordb/salesOrder'
import { Customer } from './tailordb/customer'
import helloWorld from './resolvers/hello-world';
import orderSummary from './resolvers/order-summary';
import externalLib from './resolvers/external-lib';
import { supplier } from './tailordb/supplier';
import { purchaseOrder } from './tailordb/purchaseOrder';

Tailor.init(process.cwd());
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

const app = workspace.newApplication('my_app');

workspace.apply();
