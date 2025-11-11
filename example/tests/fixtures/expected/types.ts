export type Customer = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  country: string;
  postalCode: string;
  address?: string | null;
  city?: string | null;
  fullAddress: string;
  state: string;
  createdAt: Date;
  updatedAt?: Date | null;
  salesOrders?: SalesOrder[] | null;
};

export type Invoice = {
  id: string;
  invoiceNumber: string;
  salesOrderID: string;
  salesOrder: SalesOrder;
  amount?: number | null;
  sequentialId: number;
  status?: "draft" | "sent" | "paid" | "cancelled" | null;
  createdAt: Date;
  updatedAt?: Date | null;
};

export type NestedProfile = {
  id: string;
  userInfo: {
    name: string;
    age?: number | null;
    bio?: string | null;
    email: string;
    phone?: string | null;
  };
  metadata: {
    created: Date;
    lastUpdated?: Date | null;
    version: number;
  };
  archived?: boolean | null;
  createdAt: Date;
  updatedAt?: Date | null;
};

export type PurchaseOrder = {
  id: string;
  supplierID: string;
  supplier: Supplier;
  totalPrice: number;
  discount?: number | null;
  status: string;
  attachedFiles: {
    id: string;
    name: string;
    size: number;
    type: "text" | "image";
  }[];
  createdAt: Date;
  updatedAt?: Date | null;
};

export type SalesOrder = {
  id: string;
  customerID: string;
  customer: Customer;
  approvedByUserIDs?: string[] | null;
  totalPrice?: number | null;
  discount?: number | null;
  status?: string | null;
  cancelReason?: string | null;
  canceledAt?: Date | null;
  createdAt: Date;
  updatedAt?: Date | null;
  invoice?: Invoice | null;
};

export type SalesOrderCreated = {
  id: string;
  salesOrderID: string;
  customerID: string;
  totalPrice?: number | null;
  status?: string | null;
};

export type Selfie = {
  id: string;
  name: string;
  parentID?: string | null;
  parent?: Selfie | null;
  dependId?: string | null;
  dependsOn?: Selfie | null;
  children?: Selfie[] | null;
  dependedBy?: Selfie | null;
};

export type Supplier = {
  id: string;
  name: string;
  phone: string;
  fax?: string | null;
  email?: string | null;
  postalCode: string;
  country: string;
  state: "Alabama" | "Alaska";
  city: string;
  createdAt: Date;
  updatedAt?: Date | null;
  purchaseOrders?: PurchaseOrder[] | null;
};

export type User = {
  id: string;
  name: string;
  email: string;
  status?: string | null;
  department?: string | null;
  role: "MANAGER" | "STAFF";
  createdAt: Date;
  updatedAt?: Date | null;
  setting?: UserSetting | null;
};

export type UserSetting = {
  id: string;
  language: "jp" | "en";
  userID: string;
  user: User;
  createdAt: Date;
  updatedAt?: Date | null;
};
