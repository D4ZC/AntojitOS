export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  version: number;
  createdAt: string;
}

export interface CreateCustomerInput {
  name: string;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface CustomersApi {
  customers(): Promise<Customer[]>;
  createCustomer(input: CreateCustomerInput): Promise<{ customer: Customer }>;
  updateCustomer(id: string, input: Partial<CreateCustomerInput> & {
    expectedVersion: number;
    active?: boolean;
  }): Promise<{ customer: Customer }>;
}

export type CustomerPickerApi = Pick<CustomersApi, "customers" | "createCustomer">;
