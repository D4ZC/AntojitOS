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

export interface PrintJob {
  id: string;
  ticketId: string;
  kind: "addition" | "cancellation" | "reprint";
  attempt: number;
  claimToken: string;
  payload: ProductionPayload;
}

export interface AgentCredentials {
  id: string;
  token: string;
}
