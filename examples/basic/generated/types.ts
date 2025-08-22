export type Customer = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  country: string;
  postalCode: string;
  address?: string | null;
  city?: string | null;
  fullAddress?: string | null;
  state: string;
  createdAt: Date;
  updatedAt?: Date | null;
  salesOrders?: SalesOrder[] | null;
};

export type Invoice = {
  id: string;
  invoiceNumber?: string | null;
  salesOrderID: string;
  salesOrder: SalesOrder;
  amount?: number | null;
  sequentialId?: number | null;
  status?: "draft" | "sent" | "paid" | "cancelled" | null;
  createdAt: Date;
  updatedAt?: Date | null;
};

export type NestedProfile = {
  id: string;
  userInfo: {
    personal: {
      name: string;
      age?: number | null;
      bio?: string | null;
    };
    contact: {
      email: string;
      phone?: string | null;
      address: {
        street: string;
        city: string;
        country: string;
        coordinates?: {
          latitude: number;
          longitude: number;
        } | null;
      };
    };
    preferences?: {
      notifications: {
        email: boolean;
        sms: boolean;
        push: boolean;
      };
      privacy?: {
        profileVisible: boolean;
        dataSharing: boolean;
      } | null;
    } | null;
  };
  metadata: {
    created: Date;
    lastUpdated?: Date | null;
    version: number;
  };
  archived?: boolean | null;
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

export type Role = {
  id: string;
  name: string;
  users?: User[] | null;
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
  roleId: string;
  role: Role;
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
