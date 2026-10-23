export type AccountingPaymentMethod = "CASH" | "CARD" | "TRANSFER";
export type AccountingPaymentSource = "business_cash" | "external";

export interface AccountingSupplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  taxId: string | null;
  notes: string | null;
  active: boolean;
  version: number;
  createdAt: string;
}

export interface AccountingSupplierInput {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  taxId?: string | null;
  notes?: string | null;
}

export interface AccountingPayment {
  id: string;
  amountInCents: number;
  methodCode: AccountingPaymentMethod;
  paidOn: string;
  reference: string | null;
  source: AccountingPaymentSource;
  cashMovementId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface AccountingBill {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  description: string;
  amountInCents: number;
  paidInCents: number;
  outstandingInCents: number;
  issuedOn: string;
  dueOn: string | null;
  reference: string | null;
  version: number;
  createdAt: string;
  payments: AccountingPayment[];
  voidedAt: string | null;
  voidReason: string | null;
}

export interface AccountingBillInput {
  supplierId?: string | null;
  description: string;
  amountInCents: number;
  issuedOn: string;
  dueOn?: string | null;
  reference?: string | null;
}

export interface AccountingPaymentInput {
  expectedVersion: number;
  amountInCents: number;
  methodCode: AccountingPaymentMethod;
  paidOn: string;
  reference?: string | null;
  source: AccountingPaymentSource;
}

export interface AccountingPeriod { from: string; to: string }

export interface AccountingSummary extends AccountingPeriod {
  sales: { grossInCents: number; refundedInCents: number; netInCents: number; receiptCount: number };
  expenses: { supplierPaymentsInCents: number; manualCashOutInCents: number; totalInCents: number };
  balanceInCents: number;
  outstandingInCents: number;
}

export interface AccountingApi {
  accountingSuppliers(): Promise<{ suppliers: AccountingSupplier[] }>;
  createAccountingSupplier(input: AccountingSupplierInput): Promise<{ supplier: AccountingSupplier }>;
  updateAccountingSupplier(
    supplierId: string,
    input: Partial<AccountingSupplierInput> & { expectedVersion: number; active?: boolean },
  ): Promise<{ supplier: AccountingSupplier }>;
  accountingBills(): Promise<{ bills: AccountingBill[] }>;
  createAccountingBill(input: AccountingBillInput): Promise<{ bill: AccountingBill }>;
  voidAccountingBill(billId: string, input: { expectedVersion: number; reason: string }): Promise<{ bill: AccountingBill }>;
  payAccountingBill(billId: string, input: AccountingPaymentInput): Promise<{ bill: AccountingBill }>;
  voidAccountingPayment(
    billId: string,
    paymentId: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<{ bill: AccountingBill }>;
  accountingSummary(period: AccountingPeriod): Promise<AccountingSummary>;
}

export const accountingToday = (): string => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export const accountingDateLabel = (value: string): string => new Intl.DateTimeFormat("es-MX", {
  timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
}).format(new Date(`${value}T12:00:00Z`));

export const accountingPesosToCents = (value: string): number | null => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
};

export const accountingCsv = (rows: ReadonlyArray<ReadonlyArray<string | number>>): string =>
  "\uFEFF" + rows.map((row) => row.map((value) => {
    if (typeof value === "number") return String(value);
    // Los nombres y referencias del usuario deben abrirse como texto en Excel.
    const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(";")).join("\r\n");
