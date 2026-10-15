export interface ProductionPayload {
  ticketId: string;
  kind: "addition" | "cancellation" | "reprint";
  center: { id: string; code: string; name: string };
  service: {
    accountId: string;
    type: "table" | "quick" | "takeaway";
    label: string;
  };
  roundSequence: number;
  items: Array<{
    productName: string;
    quantity: number;
    note: string | null;
    modifiers: string[];
  }>;
  cancellationReason?: string;
  reprint?: { reason: string; requestedBy: string };
}

export interface ReceiptPayload {
  kind: "receipt" | "receipt_reprint";
  receipt: {
    id: string;
    folio: string;
    issuedAt: string;
    account: {
      tableName: string | null;
      reference: string | null;
      serviceType: "table" | "quick" | "takeaway";
      items: Array<{
        productName: string;
        quantity: number;
        preparationState: string;
        lineTotalInCents: number;
      }>;
    };
    payments: Array<{
      method: { name: string };
      totalInCents: number;
      reference: string | null;
    }>;
    totals: {
      saleInCents: number;
      tipInCents: number;
      changeInCents: number;
    };
  };
  reprint?: { reason: string; requestedBy: string };
}

export interface ShiftClosePayload {
  kind: "shift_close";
  close: {
    id: string;
    closedAt: string;
    report: {
      register: { name: string };
      shift: { openedAt: string };
      sales: {
        receiptCount: number;
        refundCount: number;
        grossSaleInCents: number;
        refundedSaleInCents: number;
        netSaleInCents: number;
        tipInCents: number;
      };
      cash: { theoreticalInCents: number };
      paymentMethods: Array<{ name: string; netInCents: number }>;
    };
    declarations: Array<{
      method: { name: string };
      declaredInCents: number;
      differenceInCents: number;
    }>;
  };
}

export type PrintPayload = ProductionPayload | ReceiptPayload | ShiftClosePayload;

export interface PrintJob {
  id: string;
  ticketId: string | null;
  receiptId: string | null;
  shiftCloseId: string | null;
  kind: PrintPayload["kind"];
  attempt: number;
  claimToken: string;
  payload: PrintPayload;
}

export interface AgentCredentials {
  id: string;
  token: string;
}
