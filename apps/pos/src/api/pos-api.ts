import { createUuid } from "@antojit-os/domain";
import type {
  AccountManagementOptions,
  AccountSummary,
  CashShiftClose,
  CashShiftContext,
  CashShiftReport,
  CatalogCategory,
  CheckoutPayment,
  OpenCounterAccount,
  PaymentMethod,
  Precheck,
  ProductionTicket,
  ServiceAccount,
  ServiceLayout,
  Session,
  SalesReceipt,
  SalesReceiptSummary,
  SeasonalProductChange,
  TerminalCredentials,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

const errorMessage = (body: unknown): string => {
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body
  ) {
    const message = (body as { message: unknown }).message;
    return Array.isArray(message) ? message.join(". ") : String(message);
  }
  return "No fue posible completar la operación";
};

export class PosApi {
  constructor(
    private readonly baseUrl: string,
    private accessToken?: string,
    private readonly createIdempotencyKey: () => string = createUuid,
  ) {}

  setAccessToken(accessToken?: string): void {
    this.accessToken = accessToken;
  }

  registerTerminal(input: {
    bootstrapToken: string;
    terminalCode: string;
    displayName: string;
    profile?: "pos" | "kds";
  }): Promise<TerminalCredentials> {
    return this.request("/v1/terminals/register", {
      method: "POST",
      headers: { "x-bootstrap-token": input.bootstrapToken },
      body: {
        siteCode: "PILOT",
        terminalCode: input.terminalCode,
        displayName: input.displayName,
        profile: input.profile ?? "pos",
      },
      authenticated: false,
    });
  }

  login(input: {
    terminal: TerminalCredentials;
    employeeCode: string;
    pin: string;
  }): Promise<Session> {
    return this.request("/v1/session/pin", {
      method: "POST",
      body: {
        terminalId: input.terminal.id,
        employeeCode: input.employeeCode,
        pin: input.pin,
        deviceToken: input.terminal.deviceToken,
      },
      authenticated: false,
    });
  }

  async catalog(): Promise<CatalogCategory[]> {
    const result = await this.request<{ categories: CatalogCategory[] }>(
      "/v1/catalog",
    );
    return result.categories;
  }

  createSeasonalProduct(input: {
    categoryId: string;
    name: string;
    priceInCents: number;
  }): Promise<SeasonalProductChange> {
    return this.request("/v1/catalog/products", {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  updateSeasonalProduct(
    productId: string,
    input: {
      expectedVersion: number;
      name?: string;
      priceInCents?: number;
      available?: boolean;
    },
  ): Promise<SeasonalProductChange> {
    return this.request(`/v1/catalog/products/${productId}`, {
      method: "PATCH",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  serviceLayout(): Promise<ServiceLayout> {
    return this.request("/v1/service-layout");
  }

  async openAccount(input: {
    serviceType: "table" | "quick" | "takeaway";
    tableId?: string;
    guestCount: number;
    reference?: string;
    customerName?: string | null;
    scheduledFor?: string | null;
  }): Promise<{ id: string }> {
    return this.request("/v1/accounts", {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  account(accountId: string): Promise<ServiceAccount> {
    return this.request(`/v1/accounts/${accountId}`);
  }

  async tableAccounts(tableId: string): Promise<AccountSummary[]> {
    const result = await this.request<{ accounts: AccountSummary[] }>(
      `/v1/accounts/table/${tableId}`,
    );
    return result.accounts;
  }

  async openCounterAccounts(): Promise<OpenCounterAccount[]> {
    const result = await this.request<{ accounts: OpenCounterAccount[] }>(
      "/v1/accounts/open-counter",
    );
    return result.accounts;
  }

  accountManagementOptions(accountId: string): Promise<AccountManagementOptions> {
    return this.request(`/v1/accounts/${accountId}/management-options`);
  }

  currentCashShift(): Promise<CashShiftContext> {
    return this.request("/v1/cash/current-shift");
  }

  openCashShift(openingFloatInCents: number): Promise<CashShiftContext> {
    return this.request("/v1/cash/shifts", {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: { openingFloatInCents },
    });
  }

  currentCashReport(): Promise<CashShiftReport> {
    return this.request("/v1/cash/shifts/current/report");
  }

  createCashMovement(input: {
    direction: "in" | "out";
    amountInCents: number;
    reason: string;
  }): Promise<{ id: string }> {
    return this.request("/v1/cash/shifts/current/movements", {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  closeCashShift(input: {
    expectedVersion: number;
    declarations: Array<{
      methodCode: "CASH" | "CARD" | "TRANSFER";
      declaredInCents: number;
    }>;
  }): Promise<CashShiftClose> {
    return this.request("/v1/cash/shifts/current/close", {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  async paymentMethods(): Promise<PaymentMethod[]> {
    const result = await this.request<{ paymentMethods: PaymentMethod[] }>(
      "/v1/sales/payment-methods",
    );
    return result.paymentMethods;
  }

  checkoutAccount(
    accountId: string,
    input: { expectedVersion: number; payments: CheckoutPayment[] },
  ): Promise<SalesReceipt> {
    return this.request(`/v1/sales/accounts/${accountId}/checkout`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  receipt(receiptId: string): Promise<SalesReceipt> {
    return this.request(`/v1/sales/receipts/${receiptId}`);
  }

  async recentReceipts(): Promise<SalesReceiptSummary[]> {
    const result = await this.request<{ receipts: SalesReceiptSummary[] }>(
      "/v1/sales/receipts",
    );
    return result.receipts;
  }

  reprintReceipt(receiptId: string, reason: string): Promise<{ jobId: string }> {
    return this.request(`/v1/sales/receipts/${receiptId}/reprints`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: { reason },
    });
  }

  refundReceipt(
    receiptId: string,
    input: { kind: "cancellation" | "refund"; reason: string },
  ): Promise<{ id: string }> {
    return this.request(`/v1/sales/receipts/${receiptId}/refunds`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  createPrecheck(accountId: string, expectedVersion: number): Promise<Precheck> {
    return this.request(`/v1/accounts/${accountId}/prechecks`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: { expectedVersion },
    });
  }

  applyAccountAdjustment(
    accountId: string,
    input: {
      kind: "discount" | "courtesy";
      calculation: "percentage" | "fixed";
      value: number;
      expectedVersion: number;
      reason: string;
    },
  ): Promise<{ accountVersion: number }> {
    return this.request(`/v1/accounts/${accountId}/adjustments`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  voidAccountAdjustment(
    accountId: string,
    adjustmentId: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<{ accountVersion: number }> {
    return this.request(
      `/v1/accounts/${accountId}/adjustments/${adjustmentId}/voids`,
      {
        method: "POST",
        idempotencyKey: this.createIdempotencyKey(),
        body: input,
      },
    );
  }

  updateAccountDetails(
    accountId: string,
    input: {
      expectedVersion: number;
      customerName?: string | null;
      scheduledFor?: string | null;
    },
  ): Promise<{ accountVersion: number }> {
    return this.request(`/v1/accounts/${accountId}/details`, {
      method: "PATCH",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  updateAccountContext(
    accountId: string,
    input: {
      expectedVersion: number;
      tableId?: string;
      responsibleUserId?: string;
    },
  ): Promise<{ accountVersion: number }> {
    return this.request(`/v1/accounts/${accountId}/context`, {
      method: "PATCH",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  splitAccount(
    accountId: string,
    input: {
      expectedVersion: number;
      items: Array<{ itemId: string; quantity: number }>;
      reason: string;
    },
  ): Promise<{
    sourceVersion: number;
    destinationAccountId: string;
    destinationVersion: number;
  }> {
    return this.request(`/v1/accounts/${accountId}/splits`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  transferAccountItems(
    accountId: string,
    input: {
      destinationAccountId: string;
      sourceExpectedVersion: number;
      destinationExpectedVersion: number;
      items: Array<{ itemId: string; quantity: number }>;
      reason: string;
    },
  ): Promise<{ sourceVersion: number; destinationVersion: number }> {
    return this.request(`/v1/accounts/${accountId}/transfers`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  mergeAccount(
    accountId: string,
    input: {
      destinationAccountId: string;
      sourceExpectedVersion: number;
      destinationExpectedVersion: number;
      reason: string;
    },
  ): Promise<{ destinationAccountId: string; destinationVersion: number }> {
    return this.request(`/v1/accounts/${accountId}/merges`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  cancelAccount(
    accountId: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<{ accountVersion: number; status: "cancelled" }> {
    return this.request(`/v1/accounts/${accountId}/cancellations`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  addItem(
    accountId: string,
    input: {
      productId: string;
      quantity: number;
      expectedVersion: number;
      modifierIds?: string[];
      note?: string;
    },
  ): Promise<{ accountVersion: number }> {
    return this.request(`/v1/accounts/${accountId}/items`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  updateItem(
    accountId: string,
    itemId: string,
    input: { quantity: number; expectedVersion: number; note?: string },
  ): Promise<{ accountVersion: number }> {
    return this.request(`/v1/accounts/${accountId}/items/${itemId}`, {
      method: "PATCH",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  cancelItem(
    accountId: string,
    itemId: string,
    input: { expectedVersion: number; reason: string },
  ): Promise<{ accountVersion: number; state: string }> {
    return this.request(`/v1/accounts/${accountId}/items/${itemId}/cancellations`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  sendRound(
    accountId: string,
    expectedVersion: number,
  ): Promise<{ roundId: string; accountVersion: number }> {
    return this.request(`/v1/accounts/${accountId}/rounds`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: { expectedVersion },
    });
  }

  async productionTickets(): Promise<ProductionTicket[]> {
    const result = await this.request<{ tickets: ProductionTicket[] }>(
      "/v1/production/tickets",
    );
    return result.tickets;
  }

  transitionProductionTicket(
    ticketId: string,
    input: {
      status: "in_progress" | "ready" | "delivered";
      expectedVersion: number;
    },
  ): Promise<{ ticketId: string; status: string; version: number }> {
    return this.request(`/v1/production/tickets/${ticketId}`, {
      method: "PATCH",
      idempotencyKey: this.createIdempotencyKey(),
      body: input,
    });
  }

  reprintProductionTicket(
    ticketId: string,
    reason: string,
  ): Promise<{ jobId: string; ticketId: string }> {
    return this.request(`/v1/production/tickets/${ticketId}/reprints`, {
      method: "POST",
      idempotencyKey: this.createIdempotencyKey(),
      body: { reason },
    });
  }

  private async request<Response>(
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      authenticated?: boolean;
      idempotencyKey?: string;
    } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    if (options.authenticated !== false) {
      if (!this.accessToken) throw new ApiError(401, "No existe una sesión", null);
      headers.authorization = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = (await response.json().catch(() => null)) as Response;

    if (!response.ok) {
      throw new ApiError(response.status, errorMessage(body), body);
    }

    return body;
  }
}
