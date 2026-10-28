import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/pos-api";
import { RemotePosApp, type RemoteApi } from "./RemotePosApp";
import type {
  CashShiftContext,
  CashShiftReport,
  CatalogCategory,
  PaymentMethod,
  ProductionTicket,
  SalesReceipt,
  ServiceAccount,
  ServiceLayout,
  Session,
  TerminalCredentials,
} from "./api/types";

const terminal: TerminalCredentials = {
  id: "terminal-1",
  deviceToken: "device-secret",
  displayName: "Terminal 1",
};

const session: Session = {
  accessToken: "access-token",
  expiresAt: "2030-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    displayName: "Administrador",
    permissions: [
      "service.round.send",
      "service.account.manage",
      "service.account.discount",
      "service.precheck.create",
      "cash.shift.read",
      "cash.shift.open",
      "cash.shift.preview",
      "cash.shift.close",
      "cash.movement.create",
      "sales.payment.capture",
      "sales.receipt.read",
      "sales.receipt.reprint",
      "sales.refund.create",
      "catalog.product.manage",
      "accounting.manage",
      "delivery.manage",
    ],
  },
};

const catalog: CatalogCategory[] = [{
  id: "category-1",
  code: "ANTOJITOS",
  name: "Antojitos",
  color: "amber",
  seasonal: false,
  products: [{
    id: "product-1",
    code: "QUESADILLA",
    name: "Quesadilla",
    shortName: "Quesadilla",
    emoji: "🫓",
    color: "sun",
    available: true,
    version: 1,
    priceInCents: 4200,
    modifierGroups: [],
  }],
}];

const layout: ServiceLayout = {
  areas: [{
    id: "area-1",
    name: "Comedor",
    tables: [{
      id: "table-1",
      code: "TABLE-1",
      name: "Mesa 1",
      capacity: 4,
      state: "free",
      accountId: null,
      accountVersion: null,
      accountCount: 0,
    }],
  }],
};

const emptyAccount: ServiceAccount = {
  id: "account-1",
  tableId: "table-1",
  tableName: "Mesa 1",
  serviceType: "table",
  status: "open",
  reference: null,
  customerName: null,
  scheduledFor: null,
  scheduleDispatchedAt: null,
  scheduleError: null,
  guestCount: 2,
  version: 0,
  accountGroupId: "group-1",
  isPrimary: true,
  responsible: { id: "user-1", displayName: "Administrador" },
  items: [],
  adjustments: [],
  totals: {
    itemTotalInCents: 0,
    subtotalInCents: 0,
    adjustmentTotalInCents: 0,
    discountInCents: 0,
    taxInCents: 0,
    totalInCents: 0,
  },
  totalInCents: 0,
};

const pendingAccount: ServiceAccount = {
  ...emptyAccount,
  version: 1,
  items: [{
    id: "item-1",
    productId: "product-1",
    productName: "Quesadilla",
    unitPriceInCents: 4200,
    modifierTotalInCents: 0,
    quantity: 1,
    note: null,
    preparationState: "pending",
    modifiers: [],
    adjustmentInCents: 0,
    taxInCents: 579,
    lineTotalInCents: 4200,
  }],
  totals: {
    itemTotalInCents: 4200,
    subtotalInCents: 3621,
    adjustmentTotalInCents: 0,
    discountInCents: 0,
    taxInCents: 579,
    totalInCents: 4200,
  },
  totalInCents: 4200,
};

const sentAccount: ServiceAccount = {
  ...pendingAccount,
  version: 2,
  items: pendingAccount.items.map((item) => ({ ...item, preparationState: "sent" })),
};

const cashShiftContext: CashShiftContext = {
  register: { id: "register-1", code: "MAIN", name: "Caja principal" },
  shift: {
    id: "shift-1",
    status: "open",
    version: 0,
    openingFloatInCents: 50_000,
    openedBy: { id: "user-1", displayName: "Administrador" },
    openedAt: "2030-01-01T10:00:00.000Z",
  },
};

const paymentMethods: PaymentMethod[] = [
  {
    id: "method-cash",
    code: "CASH",
    name: "Efectivo",
    supportsChange: true,
    requiresReference: false,
  },
  {
    id: "method-card",
    code: "CARD",
    name: "Tarjeta",
    supportsChange: false,
    requiresReference: true,
  },
];

const paidReceipt: SalesReceipt = {
  id: "receipt-1",
  folio: "T-000001",
  status: "issued",
  issuedAt: "2030-01-01T12:00:00.000Z",
  shift: {
    id: "shift-1",
    register: { id: "register-1", code: "MAIN", name: "Caja principal" },
  },
  account: sentAccount,
  payments: [{
    id: "payment-1",
    method: paymentMethods[0]!,
    amountInCents: 4200,
    tipInCents: 420,
    totalInCents: 4620,
    tenderedInCents: 5000,
    changeInCents: 380,
    reference: null,
  }],
  totals: {
    saleInCents: 4200,
    tipInCents: 420,
    collectedInCents: 4620,
    changeInCents: 380,
  },
};

const cashReport: CashShiftReport = {
  register: cashShiftContext.register,
  shift: cashShiftContext.shift!,
  sales: {
    receiptCount: 1,
    refundCount: 0,
    subtotalInCents: 3621,
    discountInCents: 0,
    taxInCents: 579,
    grossSaleInCents: 4200,
    refundedSaleInCents: 0,
    netSaleInCents: 4200,
    tipInCents: 420,
    refundedTipInCents: 0,
    averageTicketInCents: 4200,
  },
  paymentMethods: paymentMethods.map((method) => ({
    id: method.id,
    code: method.code,
    name: method.name,
    saleInCents: method.code === "CASH" ? 4200 : 0,
    tipInCents: method.code === "CASH" ? 420 : 0,
    refundedSaleInCents: 0,
    refundedTipInCents: 0,
    netInCents: method.code === "CASH" ? 4620 : 0,
  })),
  cash: { totalInCents: 54_620, totalOutCents: 0, theoreticalInCents: 54_620 },
  movements: [],
  openAccountCount: 0,
};

const createApi = (overrides: Partial<RemoteApi> = {}): RemoteApi => ({
  accountingSuppliers: vi.fn().mockResolvedValue({ suppliers: [] }),
  createAccountingSupplier: vi.fn(),
  updateAccountingSupplier: vi.fn(),
  accountingBills: vi.fn().mockResolvedValue({ bills: [] }),
  createAccountingBill: vi.fn(),
  payAccountingBill: vi.fn(),
  voidAccountingBill: vi.fn(),
  voidAccountingPayment: vi.fn(),
  accountingSummary: vi.fn().mockResolvedValue({ from: "2026-10-01", to: "2026-10-23", sales: { grossInCents: 0, refundedInCents: 0, netInCents: 0, receiptCount: 0 }, expenses: { supplierPaymentsInCents: 0, manualCashOutInCents: 0, totalInCents: 0 }, balanceInCents: 0, outstandingInCents: 0 }),
  deliveryDrivers: vi.fn().mockResolvedValue([]),
  createDeliveryDriver: vi.fn(),
  deliveryAssignments: vi.fn().mockResolvedValue([]),
  assignDelivery: vi.fn(),
  updateDeliveryStatus: vi.fn(),
  refreshDelivery: vi.fn(),
  shareDelivery: vi.fn(),
  customers: vi.fn().mockResolvedValue([]),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  cashShiftCloses: vi.fn().mockResolvedValue([]),
  printPrecheck: vi.fn().mockResolvedValue({ status: "queued", requeued: false }),
  setAccessToken: vi.fn(),
  registerTerminal: vi.fn().mockResolvedValue(terminal),
  login: vi.fn().mockResolvedValue(session),
  catalog: vi.fn().mockResolvedValue(catalog),
  serviceLayout: vi.fn().mockResolvedValue(layout),
  openAccount: vi.fn().mockResolvedValue({ id: "account-1" }),
  account: vi.fn().mockResolvedValue(emptyAccount),
  accountProductionTickets: vi.fn().mockResolvedValue([]),
  printProductionTicket: vi.fn().mockResolvedValue({ jobId: "command-job-1", ticketId: "ticket-1", status: "queued", created: false, requeued: false }),
  tableAccounts: vi.fn().mockResolvedValue([]),
  openCounterAccounts: vi.fn().mockResolvedValue([]),
  accountManagementOptions: vi.fn().mockResolvedValue({
    users: [{ id: "user-1", displayName: "Administrador" }],
    tables: [{ id: "table-1", name: "Mesa 1" }],
    accounts: [],
  }),
  currentCashShift: vi.fn().mockResolvedValue(cashShiftContext),
  openCashShift: vi.fn().mockResolvedValue(cashShiftContext),
  currentCashReport: vi.fn().mockResolvedValue(cashReport),
  createCashMovement: vi.fn().mockResolvedValue({ id: "movement-1" }),
  closeCashShift: vi.fn().mockResolvedValue({
    id: "close-1",
    status: "closed",
    closedAt: "2030-01-01T13:00:00.000Z",
    report: cashReport,
    declarations: cashReport.paymentMethods.map((method) => ({
      method: { id: method.id, code: method.code, name: method.name },
      theoreticalInCents: method.code === "CASH" ? 54_620 : method.netInCents,
      declaredInCents: method.code === "CASH" ? 54_620 : method.netInCents,
      differenceInCents: 0,
    })),
  }),
  paymentMethods: vi.fn().mockResolvedValue(paymentMethods),
  checkoutAccount: vi.fn().mockResolvedValue(paidReceipt),
  receipt: vi.fn().mockResolvedValue(paidReceipt),
  receiptPrinting: vi.fn().mockResolvedValue({
    receiptId: paidReceipt.id,
    receiptStatus: "issued",
    jobs: [],
    routing: { registerCode: "MAIN", registerName: "Caja principal", configuredAgentCount: 0, onlineAgentCount: 0 },
  }),
  printReceipt: vi.fn().mockResolvedValue({ jobId: "job-1", receiptId: paidReceipt.id, status: "queued", created: true, requeued: false }),
  recentReceipts: vi.fn().mockResolvedValue([{
    id: paidReceipt.id,
    folio: paidReceipt.folio,
    status: "issued",
    totalInCents: paidReceipt.totals.saleInCents,
    tipInCents: paidReceipt.totals.tipInCents,
    issuedAt: paidReceipt.issuedAt,
    accountLabel: "Mesa 1",
  }]),
  reprintReceipt: vi.fn().mockResolvedValue({ jobId: "job-1" }),
  refundReceipt: vi.fn().mockResolvedValue({ id: "refund-1" }),
  createPrecheck: vi.fn().mockResolvedValue({
    id: "precheck-1",
    sequence: 1,
    generatedAt: "2030-01-01T12:00:00.000Z",
    account: pendingAccount,
  }),
  applyAccountAdjustment: vi.fn().mockResolvedValue({ accountVersion: 2 }),
  voidAccountAdjustment: vi.fn().mockResolvedValue({ accountVersion: 2 }),
  updateAccountContext: vi.fn().mockResolvedValue({ accountVersion: 2 }),
  splitAccount: vi.fn().mockResolvedValue({
    sourceVersion: 2,
    destinationAccountId: "account-2",
    destinationVersion: 1,
  }),
  transferAccountItems: vi.fn().mockResolvedValue({ sourceVersion: 2, destinationVersion: 2 }),
  mergeAccount: vi.fn().mockResolvedValue({ destinationAccountId: "account-2", destinationVersion: 2 }),
  updateAccountDetails: vi.fn().mockResolvedValue({ accountVersion: 1 }),
  cancelAccount: vi.fn().mockResolvedValue({ accountVersion: 1, status: "cancelled" }),
  addItem: vi.fn().mockResolvedValue({ accountVersion: 1 }),
  updateItem: vi.fn().mockResolvedValue({ accountVersion: 2 }),
  cancelItem: vi.fn().mockResolvedValue({ accountVersion: 2, state: "cancelled" }),
  sendRound: vi.fn().mockResolvedValue({ roundId: "round-1", accountVersion: 2 }),
  createSeasonalProduct: vi.fn().mockResolvedValue({
    product: { id: "dish-2", name: "Pozole verde", priceInCents: 13_000, available: true, version: 0 },
  }),
  updateSeasonalProduct: vi.fn().mockResolvedValue({
    product: { id: "dish-1", name: "Mole", priceInCents: 11_500, available: true, version: 2 },
  }),
  updateProductPrice: vi.fn().mockResolvedValue({
    product: { id: "product-1", name: "Quesadilla", priceInCents: 4500, available: true, version: 2 },
  }),
  updateModifierPrice: vi.fn().mockResolvedValue({
    modifier: { id: "modifier-1", name: "Extra", priceDeltaInCents: 2500 },
  }),
  ...overrides,
});

const storeTerminal = () => {
  window.localStorage.setItem("antojit-os.terminal.v1", JSON.stringify(terminal));
};

const loginAndSelectTable = async (api: RemoteApi) => {
  render(<RemotePosApp api={api} />);
  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
  fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Mesa 1, libre" }));
  await screen.findByRole("button", { name: "Cambiar mesa" });
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("POS conectado", () => {
  it("registra y conserva la identidad de la terminal", async () => {
    const api = createApi();
    render(<RemotePosApp api={api} />);

    fireEvent.change(screen.getByLabelText("Token de instalación"), {
      target: { value: "bootstrap-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar terminal" }));

    expect(await screen.findByRole("heading", { name: "Acceso al punto de venta" })).toBeInTheDocument();
    expect(api.registerTerminal).toHaveBeenCalledWith({
      bootstrapToken: "bootstrap-secret",
      terminalCode: "POS-01",
      displayName: "Terminal 1",
    });
    expect(JSON.parse(window.localStorage.getItem("antojit-os.terminal.v1") ?? "null")).toEqual(terminal);
  });

  it("inicia sesión y abre una mesa libre con objetivos táctiles", async () => {
    storeTerminal();
    const api = createApi();
    await loginAndSelectTable(api);

    expect(api.setAccessToken).toHaveBeenCalledWith("access-token");
    expect(api.openAccount).toHaveBeenCalledWith({
      serviceType: "table",
      tableId: "table-1",
      guestCount: 2,
    });
    expect(screen.getByRole("button", { name: /agregar quesadilla/i })).toBeInTheDocument();
  });

  it("permite al administrador cambiar un precio fijo antes de abrir mesa y desde la comanda", async () => {
    storeTerminal();
    const updatedCatalog = catalog.map((category) => ({
      ...category,
      products: category.products.map((product) => ({ ...product, priceInCents: 4500, version: 2 })),
    }));
    const api = createApi({ catalog: vi.fn().mockResolvedValueOnce(catalog).mockResolvedValue(updatedCatalog) });
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Precios del menú" }));

    expect(api.openAccount).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Precio base de Quesadilla"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio base de Quesadilla" }));
    await waitFor(() => expect(api.updateProductPrice).toHaveBeenCalledWith("product-1", {
      expectedVersion: 1, priceInCents: 4500,
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Listo" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    fireEvent.click(screen.getByRole("button", { name: "Mesa 1, libre" }));
    expect(await screen.findByRole("button", { name: "Agregar Quesadilla, $45.00" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Precios del menú" }));
    expect(screen.getByLabelText("Precio base de Quesadilla")).toHaveValue("45");
  });

  it("oculta la administración de precios a sesiones sin permiso de catálogo", async () => {
    storeTerminal();
    const api = createApi({ login: vi.fn().mockResolvedValue({
      ...session, user: { ...session.user, permissions: session.user.permissions.filter((permission) => permission !== "catalog.product.manage") },
    }) });
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    await screen.findByRole("heading", { name: "Selecciona una mesa" });
    expect(screen.queryByRole("button", { name: "Precios del menú" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mesa 1, libre" }));
    await screen.findByRole("button", { name: /agregar quesadilla/i });
    expect(screen.queryByRole("button", { name: "Precios del menú" })).not.toBeInTheDocument();
    expect(api.updateProductPrice).not.toHaveBeenCalled();
    expect(api.updateModifierPrice).not.toHaveBeenCalled();
  });

  it("recarga los precios al abrir una mesa aunque el mesero ya tuviera sesión iniciada", async () => {
    storeTerminal();
    const updated = catalog.map((category) => ({ ...category, products: category.products.map((product) => ({ ...product, version: 2, priceInCents: 4500 })) }));
    const api = createApi({
      login: vi.fn().mockResolvedValue({ ...session, user: { ...session.user, permissions: ["service.account.open", "service.item.edit"] } }),
      catalog: vi.fn().mockResolvedValueOnce(catalog).mockResolvedValue(updated),
    });
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    await screen.findByRole("button", { name: "Mesa 1, libre" });
    expect(api.catalog).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Mesa 1, libre" }));
    expect(await screen.findByRole("button", { name: "Agregar Quesadilla, $45.00" })).toBeInTheDocument();
    expect(api.catalog).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Precios del menú" })).not.toBeInTheDocument();
  });

  it("actualiza precios por foco, consulta periódica y visibilidad sin cambiar la cuenta ni la nota en edición", async () => {
    storeTerminal();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const intervals = vi.spyOn(window, "setInterval");
    const initial = { ...sentAccount, items: sentAccount.items.map((item) => ({ ...item, note: "Sin crema" })) };
    const api = createApi({ account: vi.fn().mockResolvedValue(initial) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "+ Nota" }));
    fireEvent.change(screen.getByLabelText("Nota para preparación"), { target: { value: "Sin crema, bien dorada" } });
    const prices = (priceInCents: number) => catalog.map((category) => ({ ...category, products: category.products.map((product) => ({ ...product, priceInCents })) }));
    vi.mocked(api.catalog).mockResolvedValue(prices(4500));
    fireEvent.focus(window);
    expect(await screen.findByRole("button", { name: "Agregar Quesadilla, $45.00" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nota para preparación")).toHaveValue("Sin crema, bien dorada");
    expect(screen.getByText("Nota: Sin crema")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(api.account).toHaveBeenCalledTimes(1);
    const callback = intervals.mock.calls.filter(([handler, delay]) => typeof handler === "function" && delay === 15_000).at(-1)?.[0];
    expect(callback).toBeTypeOf("function");
    vi.mocked(api.catalog).mockResolvedValue(prices(4800));
    await act(async () => { if (typeof callback === "function") callback(); });
    expect(screen.getByRole("button", { name: "Agregar Quesadilla, $48.00" })).toBeInTheDocument();
    const callsBeforeHidden = vi.mocked(api.catalog).mock.calls.length;
    visibility.mockReturnValue("hidden");
    fireEvent.focus(window);
    await act(async () => { if (typeof callback === "function") callback(); });
    expect(api.catalog).toHaveBeenCalledTimes(callsBeforeHidden);
    vi.mocked(api.catalog).mockResolvedValue(prices(5000));
    visibility.mockReturnValue("visible");
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByRole("button", { name: "Agregar Quesadilla, $50.00" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nota para preparación")).toHaveValue("Sin crema, bien dorada");
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(api.account).toHaveBeenCalledTimes(1);
  });

  it("descarta una respuesta de catálogo antigua si otra consulta más reciente ya terminó", async () => {
    storeTerminal();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const api = createApi();
    await loginAndSelectTable(api);
    let resolveOlder: ((value: CatalogCategory[]) => void) | undefined;
    const older = catalog.map((category) => ({ ...category, products: category.products.map((product) => ({ ...product, priceInCents: 4500 })) }));
    const newer = catalog.map((category) => ({ ...category, products: category.products.map((product) => ({ ...product, priceInCents: 4800 })) }));
    vi.mocked(api.catalog).mockImplementationOnce(() => new Promise((resolve) => { resolveOlder = resolve; })).mockResolvedValue(newer);
    fireEvent.focus(window);
    fireEvent.focus(window);
    expect(await screen.findByRole("button", { name: "Agregar Quesadilla, $48.00" })).toBeInTheDocument();
    await act(async () => resolveOlder?.(older));
    expect(screen.getByRole("button", { name: "Agregar Quesadilla, $48.00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar Quesadilla, $45.00" })).not.toBeInTheDocument();
  });

  it("descarta consultas pendientes de una sesión cerrada incluso después de iniciar otra sesión", async () => {
    storeTerminal();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const api = createApi();
    await loginAndSelectTable(api);
    let resolvePreviousSession: ((value: CatalogCategory[]) => void) | undefined;
    vi.mocked(api.catalog).mockImplementationOnce(() => new Promise((resolve) => { resolvePreviousSession = resolve; }));
    fireEvent.focus(window);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión de Administrador" }));
    await screen.findByRole("heading", { name: "Acceso al punto de venta" });
    const current = catalog.map((category) => ({ ...category, products: category.products.map((product) => ({ ...product, priceInCents: 5000 })) }));
    vi.mocked(api.catalog).mockResolvedValue(current);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mesa 1, libre" }));
    expect(await screen.findByRole("button", { name: "Agregar Quesadilla, $50.00" })).toBeInTheDocument();
    await act(async () => resolvePreviousSession?.(catalog));
    expect(screen.getByRole("button", { name: "Agregar Quesadilla, $50.00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar Quesadilla, $42.00" })).not.toBeInTheDocument();
  });

  it("pausa la actualización automática mientras se editan precios", async () => {
    storeTerminal();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const api = createApi();
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Precios del menú" }));
    fireEvent.change(screen.getByLabelText("Precio base de Quesadilla"), { target: { value: "46" } });
    const previousCalls = vi.mocked(api.catalog).mock.calls.length;
    fireEvent.focus(window);
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => undefined);
    expect(api.catalog).toHaveBeenCalledTimes(previousCalls);
    expect(screen.getByLabelText("Precio base de Quesadilla")).toHaveValue("46");
  });

  it("permite recuperar un servicio sin mesa que quedó abierto", async () => {
    storeTerminal();
    const quickAccount: ServiceAccount = {
      ...emptyAccount,
      id: "quick-account-1",
      tableId: null,
      tableName: null,
      serviceType: "quick",
      guestCount: 1,
    };
    const api = createApi({
      openCounterAccounts: vi.fn().mockResolvedValue([{
        id: quickAccount.id,
        label: "Venta rápida",
        serviceType: "quick",
        sequence: 1,
        version: 0,
        responsible: quickAccount.responsible,
        itemCount: 0,
        totalInCents: 0,
        openedAt: "2030-01-01T10:00:00.000Z",
      }]),
      account: vi.fn().mockResolvedValue(quickAccount),
    });
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));

    fireEvent.click(await screen.findByRole("button", { name: "Abrir Venta rápida 1" }));

    expect(await screen.findByRole("heading", { name: "Venta rápida" })).toBeInTheDocument();
    expect(api.account).toHaveBeenCalledWith("quick-account-1");
  });

  it("permite agregar Con todo a una comanda ya enviada sin cambiar su cantidad", async () => {
    storeTerminal();
    const updated = { ...sentAccount, version: 3, items: sentAccount.items.map((item) => ({ ...item, note: "Con todo" })) };
    const api = createApi({ account: vi.fn().mockResolvedValueOnce(sentAccount).mockResolvedValue(updated) });
    await loginAndSelectTable(api);

    expect(screen.getByRole("button", { name: "Agregar una unidad de Quesadilla" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "+ Nota" }));
    fireEvent.click(screen.getByRole("button", { name: "Con todo" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar nota" }));

    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith("account-1", "item-1", {
      quantity: 1, expectedVersion: 2, note: "Con todo",
    }));
    expect(await screen.findByText("Nota: Con todo")).toBeInTheDocument();
    expect(api.sendRound).not.toHaveBeenCalled();
  });

  it("combina la preparación de una comanda enviada y reemplaza indicaciones opuestas", async () => {
    storeTerminal();
    const note = "Bien dorada, Sin picante, Sin lechuga, Con salsa y queso";
    const initial = { ...sentAccount, items: sentAccount.items.map((item) => ({ ...item, note: "Bien dorada" })) };
    const updated = { ...sentAccount, version: 3, items: sentAccount.items.map((item) => ({ ...item, note })) };
    const api = createApi({ account: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(updated) });
    await loginAndSelectTable(api);

    fireEvent.click(screen.getByRole("button", { name: "+ Nota" }));
    const input = screen.getByLabelText("Nota para preparación");
    expect(input).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Con picante" }));
    fireEvent.click(screen.getByRole("button", { name: "Sin picante" }));
    fireEvent.click(screen.getByRole("button", { name: "Con col y lechuga" }));
    fireEvent.click(screen.getByRole("button", { name: "Sin lechuga" }));
    fireEvent.click(screen.getByRole("button", { name: "Con salsa y queso" }));
    expect(screen.getByRole("button", { name: "Con picante" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Con col y lechuga" })).toHaveAttribute("aria-pressed", "false");
    expect(input).toHaveValue(note);
    fireEvent.click(screen.getByRole("button", { name: "Guardar nota" }));

    await waitFor(() => expect(api.updateItem).toHaveBeenCalledWith("account-1", "item-1", {
      quantity: 1, expectedVersion: 2, note,
    }));
    expect(await screen.findByText(`Nota: ${note}`)).toBeInTheDocument();
    expect(api.sendRound).not.toHaveBeenCalled();
  });

  it("descarta automáticamente una venta rápida vacía al salir", async () => {
    storeTerminal();
    const quick = { ...emptyAccount, tableId: null, tableName: null, serviceType: "quick" as const };
    const api = createApi({ account: vi.fn().mockResolvedValue(quick) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mesa" }));

    await waitFor(() => expect(api.cancelAccount).toHaveBeenCalledWith("account-1", {
      expectedVersion: 0, reason: "Servicio sin productos descartado al salir",
    }));
    expect(await screen.findByRole("heading", { name: "Selecciona una mesa" })).toBeInTheDocument();
  });

  it("descarta la venta rápida vacía antes de cerrar sesión", async () => {
    storeTerminal();
    const quick = { ...emptyAccount, tableId: null, tableName: null, serviceType: "quick" as const };
    const api = createApi({ account: vi.fn().mockResolvedValue(quick) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión de Administrador" }));
    await waitFor(() => expect(api.cancelAccount).toHaveBeenCalledWith("account-1", {
      expectedVersion: 0, reason: "Servicio sin productos descartado al cerrar sesión",
    }));
    expect(await screen.findByRole("heading", { name: "Acceso al punto de venta" })).toBeInTheDocument();
  });

  it("permite al mesero cancelar su venta rápida sin permiso de gestión", async () => {
    storeTerminal();
    const quick = { ...pendingAccount, tableId: null, tableName: null, serviceType: "quick" as const };
    const api = createApi({
      account: vi.fn().mockResolvedValue(quick),
      login: vi.fn().mockResolvedValue({ ...session, user: { ...session.user, permissions: ["service.account.open", "service.item.edit"] } }),
    });
    await loginAndSelectTable(api);
    expect(screen.queryByRole("button", { name: "Gestionar cuenta" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    expect(screen.getByRole("button", { name: "Confirmar cancelación" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Error" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Sin razón" }));
    expect(screen.getByLabelText("Motivo de cancelación")).toHaveValue("Sin razón");
    expect(api.cancelAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(api.cancelAccount).toHaveBeenCalledWith("account-1", { expectedVersion: 1, reason: "Sin razón" }));
    expect(await screen.findByRole("heading", { name: "Selecciona una mesa" })).toBeInTheDocument();
  });

  it("muestra el motivo de un conflicto que no cambió la versión de la cuenta", async () => {
    storeTerminal();
    const message = "Quita la programación antes de mover artículos";
    const api = createApi({
      account: vi.fn().mockResolvedValue(pendingAccount),
      updateAccountDetails: vi.fn().mockRejectedValue(new ApiError(409, message, {})),
    });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Cliente y programación" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0));
  });

  it("permite cancelar una venta rápida pendiente desde la salida", async () => {
    storeTerminal();
    const quick = { ...pendingAccount, tableId: null, tableName: null, serviceType: "quick" as const };
    const api = createApi({ account: vi.fn().mockResolvedValue(quick) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mesa" }));
    expect(await screen.findByRole("heading", { name: "Salir de Venta rápida" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pedido y salir" }));

    await waitFor(() => expect(api.cancelAccount).toHaveBeenCalledWith("account-1", {
      expectedVersion: 1, reason: "Pedido sin enviar descartado al salir",
    }));
    expect(await screen.findByRole("heading", { name: "Selecciona una mesa" })).toBeInTheDocument();
  });

  it("permite cancelar un servicio recuperado desde su botón directo", async () => {
    storeTerminal();
    const quick = { ...emptyAccount, tableId: null, tableName: null, serviceType: "quick" as const };
    const api = createApi({ account: vi.fn().mockResolvedValue(quick) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    fireEvent.change(screen.getByLabelText("Motivo de cancelación"), { target: { value: "Abierto por error" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));

    await waitFor(() => expect(api.cancelAccount).toHaveBeenCalledWith("account-1", {
      expectedVersion: 0, reason: "Abierto por error",
    }));
  });

  it("permite cancelar un artículo con un motivo rápido sin ejecutar la acción hasta confirmar", async () => {
    storeTerminal();
    const api = createApi({ account: vi.fn().mockResolvedValue(pendingAccount) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    const confirm = screen.getByRole("button", { name: "Confirmar cancelación" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cambio de pedido" }));
    expect(screen.getByLabelText("Motivo de cancelación")).toHaveValue("Cambio de pedido");
    expect(screen.getByRole("button", { name: "Cambio de pedido" })).toHaveAttribute("aria-pressed", "true");
    expect(api.cancelItem).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(api.cancelItem).toHaveBeenCalledWith("account-1", pendingAccount.items[0]!.id, {
      expectedVersion: 1, reason: "Cambio de pedido",
    }));
  });

  it("guarda cliente opcional y programa el envío automático en la hora local elegida", async () => {
    storeTerminal();
    const date = "2099-10-24T18:30";
    const scheduled = { ...pendingAccount, customerName: "Doña Lupita", scheduledFor: new Date(date).toISOString(), scheduleDispatchedAt: null };
    const api = createApi({ account: vi.fn().mockResolvedValueOnce(pendingAccount).mockResolvedValue(scheduled) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Cliente y programación" }));
    fireEvent.change(screen.getByLabelText("Nombre del cliente (opcional)"), { target: { value: " Doña Lupita " } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Programar envío a cocina" }));
    fireEvent.change(screen.getByLabelText("Fecha y hora de envío a cocina"), { target: { value: date } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos" }));

    await waitFor(() => expect(api.updateAccountDetails).toHaveBeenCalledWith("account-1", {
      expectedVersion: 1, customerId: null, customerName: "Doña Lupita", scheduledFor: new Date(date).toISOString(),
    }));
    expect(await screen.findByText("Doña Lupita")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Envío automático programado/ })).toBeDisabled();
    expect(api.sendRound).not.toHaveBeenCalled();
  });

  it("inicia un pedido programado, agrega productos y lo conserva al salir", async () => {
    storeTerminal();
    const date = "2099-10-24T18:30";
    const scheduledFor = new Date(date).toISOString();
    const takeaway: ServiceAccount = {
      ...emptyAccount, serviceType: "takeaway", tableId: null, tableName: null,
    };
    const scheduledEmpty: ServiceAccount = {
      ...takeaway, version: 1, customerName: "Doña Lupita", scheduledFor, scheduleDispatchedAt: null,
    };
    const scheduledOrder: ServiceAccount = {
      ...pendingAccount, ...scheduledEmpty, version: 2,
      items: pendingAccount.items, totals: pendingAccount.totals, totalInCents: pendingAccount.totalInCents,
    };
    const api = createApi({
      account: vi.fn().mockResolvedValueOnce(takeaway).mockResolvedValueOnce(scheduledEmpty)
        .mockResolvedValue(scheduledOrder),
      updateAccountDetails: vi.fn().mockResolvedValue({ accountVersion: 1 }),
      addItem: vi.fn().mockResolvedValue({ accountVersion: 2 }),
      openCounterAccounts: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{
        id: scheduledOrder.id, label: "Para llevar", serviceType: "takeaway", sequence: 1,
        version: scheduledOrder.version, responsible: scheduledOrder.responsible,
        itemCount: 1, totalInCents: scheduledOrder.totalInCents,
        openedAt: "2030-01-01T10:00:00.000Z", customerName: "Doña Lupita", scheduledFor,
        scheduleDispatchedAt: null,
      }]),
    });
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    fireEvent.click(await screen.findByRole("button", { name: /Programar pedido/ }));

    await screen.findByRole("dialog", { name: "Cliente y programación" });
    expect(screen.getByRole("checkbox", { name: "Programar envío a cocina" })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Nombre del cliente (opcional)"), { target: { value: "Doña Lupita" } });
    fireEvent.change(screen.getByLabelText("Fecha y hora de envío a cocina"), { target: { value: date } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cliente y programación" })).not.toBeInTheDocument());
    expect(api.openAccount).toHaveBeenCalledWith({ serviceType: "takeaway", guestCount: 2 });
    expect(api.updateAccountDetails).toHaveBeenCalledWith("account-1", {
      expectedVersion: 0, customerId: null, customerName: "Doña Lupita", scheduledFor,
    });
    expect(screen.getByRole("button", { name: /Envío automático programado/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Agregar Quesadilla/ }));
    await screen.findByText("Quesadilla", { selector: ".order-item strong" });
    expect(api.addItem).toHaveBeenCalledWith("account-1", {
      productId: "product-1", quantity: 1, expectedVersion: 1, modifierIds: [],
    });
    fireEvent.click(screen.getByRole("button", { name: "Cambiar mesa" }));

    await screen.findByRole("button", { name: "Abrir Para llevar 1" });
    expect(screen.getByText("Cliente: Doña Lupita")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Salir de Para llevar" })).not.toBeInTheDocument();
    expect(api.cancelAccount).not.toHaveBeenCalled();
    expect(api.sendRound).not.toHaveBeenCalled();
  });

  it("permite quitar la programación y volver al envío manual", async () => {
    storeTerminal();
    const scheduled = { ...pendingAccount, scheduledFor: "2099-10-24T18:30:00.000Z", scheduleDispatchedAt: null };
    const api = createApi({ account: vi.fn().mockResolvedValueOnce(scheduled).mockResolvedValue(pendingAccount) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Cliente y programación" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Programar envío a cocina" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(api.updateAccountDetails).toHaveBeenCalledWith("account-1", {
      expectedVersion: 1, customerId: null, customerName: null, scheduledFor: null,
    }));
    expect(await screen.findByRole("button", { name: /Enviar comanda/ })).toBeEnabled();
  });

  it("rechaza programar un pedido en una fecha pasada", async () => {
    storeTerminal();
    const api = createApi();
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Cliente y programación" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Programar envío a cocina" }));
    fireEvent.change(screen.getByLabelText("Fecha y hora de envío a cocina"), { target: { value: "2000-01-01T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos" }));
    expect(screen.getAllByText("Elige una fecha y hora futuras para enviar a cocina").length).toBeGreaterThan(0);
    expect(api.updateAccountDetails).not.toHaveBeenCalled();
  });

  it("permite al administrador abrir contabilidad desde la cuenta", async () => {
    storeTerminal();
    const api = createApi();
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Contabilidad y proveedores" }));
    expect(await screen.findByRole("heading", { name: /Contabilidad/ })).toBeInTheDocument();
    await waitFor(() => expect(api.accountingSuppliers).toHaveBeenCalled());
  });

  it("oculta contabilidad a un operador sin el permiso administrativo", async () => {
    storeTerminal();
    const api = createApi({ login: vi.fn().mockResolvedValue({ ...session, user: { ...session.user, permissions: ["delivery.manage"] } }) });
    await loginAndSelectTable(api);
    expect(screen.queryByRole("button", { name: "Contabilidad y proveedores" })).not.toBeInTheDocument();
    expect(api.accountingSuppliers).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Asignar repartidor" })).toBeDisabled();
  });

  it("abre repartos con la comanda actual lista para asignar", async () => {
    storeTerminal();
    const api = createApi({ account: vi.fn().mockResolvedValue(sentAccount) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Asignar repartidor" }));
    expect(await screen.findByRole("heading", { name: "Repartos" })).toBeInTheDocument();
    expect(screen.getByLabelText("Dirección de entrega")).toBeInTheDocument();
    await waitFor(() => expect(api.deliveryDrivers).toHaveBeenCalled());
    expect(api.checkoutAccount).not.toHaveBeenCalled();
  });

  it("agrega un producto y envía la ronda al servidor", async () => {
    storeTerminal();
    const accountMock = vi.fn()
      .mockResolvedValueOnce(emptyAccount)
      .mockResolvedValueOnce(pendingAccount)
      .mockResolvedValueOnce(sentAccount);
    const ticket: ProductionTicket = {
      id: "ticket-1", accountId: "account-1", roundId: "round-1",
      center: { id: "center-1", code: "KITCHEN", name: "Cocina" },
      kind: "addition", roundSequence: 1, status: "pending", version: 0,
      service: { type: "table", label: "Mesa 1" },
      createdAt: "2030-01-01T12:00:00.000Z", startedAt: null, readyAt: null,
      printStatus: "queued", printLastError: null,
      items: [{ id: "ticket-item-1", orderItemId: "item-1", productName: "Quesadilla", quantity: 1, note: null, modifiers: [] }],
    };
    const api = createApi({
      account: accountMock,
      accountProductionTickets: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([ticket]),
    });
    await loginAndSelectTable(api);

    fireEvent.click(screen.getByRole("button", { name: /agregar quesadilla/i }));
    expect(await screen.findByText("Quesadilla", { selector: ".order-item strong" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /enviar comanda/i }));

    await waitFor(() => expect(screen.getByText("Enviado")).toBeInTheDocument());
    expect(api.addItem).toHaveBeenCalledWith("account-1", {
      productId: "product-1",
      quantity: 1,
      expectedVersion: 0,
      modifierIds: [],
    });
    expect(api.sendRound).toHaveBeenCalledWith("account-1", 1);
    const printButton = await screen.findByRole("button", { name: /Imprimir comanda/i });
    expect(screen.getByText("Comanda enviada. Impresión automática en cola.")).toBeInTheDocument();
    expect(api.printProductionTicket).not.toHaveBeenCalled();
    fireEvent.click(printButton);
    await waitFor(() => expect(api.printProductionTicket).toHaveBeenCalledWith("ticket-1"));
    expect(api.sendRound).toHaveBeenCalledTimes(1);
  });

  it("arma varias tostadas con opciones, cantidad y observaciones por variante", async () => {
    storeTerminal();
    const tostadas: CatalogCategory = {
      id: "category-tostadas",
      code: "TOSTADAS",
      name: "Tostadas",
      color: "sun",
      seasonal: false,
      products: [
        {
          ...catalog[0]!.products[0]!,
          id: "tostada",
          code: "TOSTADA",
          name: "Tostada",
          shortName: "Tostada",
          priceInCents: 3500,
          modifierGroups: [{
            id: "group-tostada",
            name: "Preparación",
            minimumSelections: 1,
            maximumSelections: 1,
            options: [
              { id: "pierna", name: "Pierna", priceDeltaInCents: 0, available: true },
              { id: "lengua", name: "Lengua", priceDeltaInCents: 0, available: true },
            ],
          }],
        },
        {
          ...catalog[0]!.products[0]!,
          id: "sencilla",
          code: "TOSTADA-SENCILLA",
          name: "Tostada sencilla",
          shortName: "Sencilla",
          priceInCents: 2000,
        },
      ],
    };
    const addItem = vi.fn()
      .mockResolvedValueOnce({ accountVersion: 1 })
      .mockResolvedValueOnce({ accountVersion: 2 });
    const api = createApi({ catalog: vi.fn().mockResolvedValue([tostadas]), addItem });
    await loginAndSelectTable(api);

    fireEvent.click(screen.getByRole("button", { name: /agregar tostada, /i }));
    const dialog = await screen.findByRole("dialog", { name: "Tostada" });
    fireEvent.click(screen.getByRole("button", { name: /pierna/i }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar una pieza" }));
    fireEvent.click(screen.getByRole("button", { name: "Sin cebolla" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar otra variante" }));
    expect(dialog).toHaveTextContent("Pierna · Sin cebolla");
    fireEvent.click(screen.getByRole("button", { name: /^sencilla/i }));
    fireEvent.click(screen.getByRole("button", { name: /agregar 3 a la orden/i }));

    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(2));
    expect(addItem).toHaveBeenNthCalledWith(1, "account-1", {
      productId: "tostada",
      quantity: 2,
      expectedVersion: 0,
      modifierIds: ["pierna"],
      note: "Sin cebolla",
    });
    expect(addItem).toHaveBeenNthCalledWith(2, "account-1", {
      productId: "sencilla",
      quantity: 1,
      expectedVersion: 1,
      modifierIds: [],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("permite al administrador cambiar el precio de un platillo del día", async () => {
    storeTerminal();
    const platillos: CatalogCategory = {
      id: "category-dia",
      code: "PLATILLOS-DIA",
      name: "Platillos del día",
      color: "clay",
      seasonal: true,
      products: [
        { ...catalog[0]!.products[0]!, id: "dish-1", code: "MOLE", name: "Mole", shortName: "Mole", priceInCents: 10_000 },
        { ...catalog[0]!.products[0]!, id: "dish-3", code: "PIPIAN", name: "Pipián", shortName: "Pipián", available: false },
      ],
    };
    const api = createApi({ catalog: vi.fn().mockResolvedValue([platillos]) });
    await loginAndSelectTable(api);

    expect(screen.queryByRole("button", { name: /agregar pipián/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar platillos" }));
    fireEvent.change(await screen.findByLabelText("Precio de Mole"), { target: { value: "115" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[0]!);

    await waitFor(() => expect(api.updateSeasonalProduct).toHaveBeenCalledWith("dish-1", {
      expectedVersion: 1,
      priceInCents: 11_500,
    }));
    expect(await screen.findByText("Mole: $115.00 · disponible hoy")).toBeInTheDocument();
    expect(api.catalog).toHaveBeenCalledTimes(3);
  });

  it("genera una precuenta táctil sin cerrar la cuenta", async () => {
    storeTerminal();
    const api = createApi({ account: vi.fn().mockResolvedValue(pendingAccount) });
    await loginAndSelectTable(api);

    fireEvent.click(screen.getByRole("button", { name: "Precuenta" }));

    expect(await screen.findByRole("heading", { name: "Precuenta #1" })).toBeInTheDocument();
    expect(api.createPrecheck).toHaveBeenCalledWith("account-1", 1);
    expect(screen.getByText("Documento informativo; todavía no representa un pago ni cierra la cuenta.")).toBeInTheDocument();
  });

  it("solicita motivo antes de aplicar un descuento", async () => {
    storeTerminal();
    const accountMock = vi.fn().mockResolvedValue(pendingAccount);
    const api = createApi({ account: accountMock });
    await loginAndSelectTable(api);

    fireEvent.click(screen.getByRole("button", { name: "Gestionar cuenta" }));
    await screen.findByRole("heading", { name: "Gestionar cuenta" });
    const apply = screen.getByRole("button", { name: "Aplicar descuento" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo de la operación"), {
      target: { value: "Cliente frecuente" },
    });
    fireEvent.click(apply);

    await waitFor(() => expect(api.applyAccountAdjustment).toHaveBeenCalledWith(
      "account-1",
      {
        kind: "discount",
        calculation: "percentage",
        value: 1000,
        expectedVersion: 1,
        reason: "Cliente frecuente",
      },
    ));
  });

  it("confirma la cancelación de una cuenta vacía y vuelve al mapa", async () => {
    storeTerminal();
    const api = createApi({ account: vi.fn().mockResolvedValue(emptyAccount) });
    await loginAndSelectTable(api);

    fireEvent.click(screen.getByRole("button", { name: "Gestionar cuenta" }));
    await screen.findByRole("heading", { name: "Gestionar cuenta" });
    const cancel = screen.getByRole("button", { name: "Cancelar cuenta y liberar mesa" });
    expect(cancel).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Error" }));
    expect(screen.getByLabelText("Motivo de la operación")).toHaveValue("Error");
    expect(api.cancelAccount).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo de la operación"), {
      target: { value: "Mesa abierta por error" },
    });
    fireEvent.click(cancel);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));

    await waitFor(() => expect(api.cancelAccount).toHaveBeenCalledWith("account-1", {
      expectedVersion: 0,
      reason: "Mesa abierta por error",
    }));
    expect(await screen.findByRole("heading", { name: "Selecciona una mesa" })).toBeInTheDocument();
  });

  it("ofrece un acceso rápido para liberar una mesa", async () => {
    storeTerminal();
    const api = createApi({ account: vi.fn().mockResolvedValue(emptyAccount) });
    await loginAndSelectTable(api);

    fireEvent.click(screen.getByRole("button", { name: "Liberar mesa" }));
    expect(await screen.findByRole("heading", { name: "Liberar Mesa 1" })).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirmar y liberar" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Mesa abierta por error" }));
    expect(screen.getByLabelText("Motivo para liberar la mesa")).toHaveValue("Mesa abierta por error");
    expect(api.cancelAccount).not.toHaveBeenCalled();
    fireEvent.click(confirm);

    await waitFor(() => expect(api.cancelAccount).toHaveBeenCalledWith("account-1", {
      expectedVersion: 0,
      reason: "Mesa abierta por error",
    }));
    expect(await screen.findByRole("heading", { name: "Selecciona una mesa" })).toBeInTheDocument();
  });

  it("cobra en efectivo, calcula propina/cambio y muestra el ticket", async () => {
    storeTerminal();
    const api = createApi({ account: vi.fn().mockResolvedValue(sentAccount) });
    await loginAndSelectTable(api);

    fireEvent.click(screen.getByRole("button", { name: "Pago" }));
    expect(await screen.findByRole("heading", { name: "Cobrar Mesa 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "10%" }));
    fireEvent.change(screen.getByLabelText("Efectivo recibido"), {
      target: { value: "50.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));

    await waitFor(() => expect(api.checkoutAccount).toHaveBeenCalledWith("account-1", {
      expectedVersion: 2,
      payments: [{
        methodCode: "CASH",
        amountInCents: 4200,
        tipInCents: 420,
        tenderedInCents: 5000,
      }],
    }));
    expect(await screen.findByRole("heading", { name: "Ticket T-000001" })).toBeInTheDocument();
    expect(screen.getByText("$3.80")).toBeInTheDocument();
    await screen.findByText("Ticket sin envío registrado");
    fireEvent.click(screen.getByRole("button", { name: "Imprimir ticket" }));
    await waitFor(() => expect(api.printReceipt).toHaveBeenCalledWith(paidReceipt.id));
    expect(api.checkoutAccount).toHaveBeenCalledTimes(1);
    expect(api.reprintReceipt).not.toHaveBeenCalled();
  });

  it("abre el turno de caja antes del primer cobro", async () => {
    storeTerminal();
    const withoutShift: CashShiftContext = {
      register: cashShiftContext.register,
      shift: null,
    };
    const api = createApi({
      account: vi.fn().mockResolvedValue(sentAccount),
      currentCashShift: vi.fn().mockResolvedValue(withoutShift),
    });
    await loginAndSelectTable(api);

    fireEvent.click(screen.getByRole("button", { name: "Pago" }));
    expect(await screen.findByRole("heading", { name: "Abrir turno de caja" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Fondo inicial"), {
      target: { value: "750.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Abrir turno" }));

    await waitFor(() => expect(api.openCashShift).toHaveBeenCalledWith(75_000));
    expect(await screen.findByRole("heading", { name: "Cobrar Mesa 1" })).toBeInTheDocument();
  });

  it("registra movimientos, reimprime y cierra el turno desde la pantalla táctil", async () => {
    storeTerminal();
    const api = createApi();
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Caja y corte" }));

    expect(await screen.findByRole("heading", { name: "Caja y corte" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Importe del movimiento"), {
      target: { value: "100.00" },
    });
    fireEvent.change(screen.getByLabelText("Motivo del movimiento"), {
      target: { value: "Compra de emergencia" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar movimiento" }));
    await waitFor(() => expect(api.createCashMovement).toHaveBeenCalledWith({
      direction: "out",
      amountInCents: 10_000,
      reason: "Compra de emergencia",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Reimprimir" }));
    fireEvent.change(screen.getByLabelText("Motivo de la acción sobre el ticket"), {
      target: { value: "Cliente solicita copia" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.reprintReceipt).toHaveBeenCalledWith(
      "receipt-1",
      "Cliente solicita copia",
    ));

    fireEvent.click(screen.getByRole("button", { name: "Cerrar turno de caja" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cierre" }));
    await waitFor(() => expect(api.closeCashShift).toHaveBeenCalled());
    expect(await screen.findByRole("heading", { name: "Turno cerrado" })).toBeInTheDocument();
  });

  it.each([
    { action: "Cancelar", title: "Cancelar ticket", kind: "cancellation", preset: "Ticket duplicado" },
    { action: "Devolver", title: "Devolver ticket", kind: "refund", preset: "Producto incorrecto" },
  ])("confirma $title con un motivo rápido", async ({ action, title, kind, preset }) => {
    storeTerminal();
    const api = createApi();
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Caja y corte" }));
    fireEvent.click(await screen.findByRole("button", { name: action }));
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: preset }));
    expect(screen.getByLabelText("Motivo de la acción sobre el ticket")).toHaveValue(preset);
    expect(api.refundReceipt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.refundReceipt).toHaveBeenCalledWith("receipt-1", { kind, reason: preset }));
  });
  it("imprime la precuenta y abre Pagar sin registrar un cobro", async () => {
    storeTerminal();
    const api = createApi({ account: vi.fn().mockResolvedValue(sentAccount), createPrecheck: vi.fn().mockResolvedValue({ id: "precheck-1", sequence: 1, generatedAt: "2030-01-01T12:00:00Z", account: sentAccount }) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Precuenta" }));
    await screen.findByRole("heading", { name: "Precuenta #1" });
    fireEvent.click(screen.getByRole("button", { name: "Imprimir precuenta" }));
    await waitFor(() => expect(api.printPrecheck).toHaveBeenCalledWith("precheck-1"));
    expect(screen.getByText("Antojitos Mexicanos Frank")).toBeInTheDocument();
    expect(screen.getByText("Tel: 3330147392")).toBeInTheDocument();
    expect(api.checkoutAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Pagar" }));
    await screen.findByRole("heading", { name: "Cobrar Mesa 1" });
    expect(api.checkoutAccount).not.toHaveBeenCalled();
  });

  it("cobra por transferencia y exige la referencia", async () => {
    storeTerminal();
    const api = createApi({ account: vi.fn().mockResolvedValue(sentAccount), paymentMethods: vi.fn().mockResolvedValue([...paymentMethods, { id: "transfer", code: "TRANSFER", name: "Transferencia", supportsChange: false, requiresReference: true }]) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Pago" }));
    fireEvent.click(await screen.findByRole("button", { name: "Transferencia" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    expect(screen.getByRole("alert")).toHaveTextContent("referencia de la transferencia");
    expect(api.checkoutAccount).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Referencia de transferencia"), { target: { value: "SPEI-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    await waitFor(() => expect(api.checkoutAccount).toHaveBeenCalledWith("account-1", { expectedVersion: 2, payments: [{ methodCode: "TRANSFER", amountInCents: 4200, tipInCents: 0, reference: "SPEI-123" }] }));
  });

  it("selecciona cantidades rápidas y conserva el cálculo de cambio", async () => {
    storeTerminal();
    const api = createApi({ account: vi.fn().mockResolvedValue(sentAccount) });
    await loginAndSelectTable(api);
    fireEvent.click(screen.getByRole("button", { name: "Pago" }));
    await screen.findByRole("heading", { name: "Cobrar Mesa 1" });
    for (const amount of [50, 100, 150, 200, 500]) {
      fireEvent.click(screen.getByRole("button", { name: `Recibido $${amount}` }));
      expect(screen.getByLabelText("Efectivo recibido")).toHaveValue(amount);
    }
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pago" }));
    await waitFor(() => expect(api.checkoutAccount).toHaveBeenCalledWith("account-1", { expectedVersion: 2, payments: [{ methodCode: "CASH", amountInCents: 4200, tipInCents: 0, tenderedInCents: 50000 }] }));
  });

  it("permite corte ciego al cajero sin consultar ventas ni diferencias", async () => {
    storeTerminal();
    const cashier = { ...session, user: { ...session.user, permissions: ["cash.shift.read", "cash.shift.open", "cash.shift.close", "sales.payment.capture"] } };
    const api = createApi({ login: vi.fn().mockResolvedValue(cashier), closeCashShift: vi.fn().mockResolvedValue({ id: "blind-close", status: "closed", closedAt: "2030-01-01T13:00:00Z", blind: true, register: cashShiftContext.register, shift: { id: "shift-1", openedAt: "2030-01-01T10:00:00Z" }, declarations: paymentMethods.map((method) => ({ method, declaredInCents: 1000 })) }) });
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "3456" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Caja y corte" }));
    await screen.findByRole("heading", { name: "Declaración y cierre" });
    expect(api.currentCashReport).not.toHaveBeenCalled();
    expect(api.recentReceipts).not.toHaveBeenCalled();
    expect(api.cashShiftCloses).not.toHaveBeenCalled();
    expect(screen.queryByText("Efectivo teórico")).not.toBeInTheDocument();
    for (const method of paymentMethods) {
      const field = screen.getByLabelText(`Declarado ${method.name}`);
      expect(field).toHaveValue(null);
      fireEvent.change(field, { target: { value: "10" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Cerrar turno de caja" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cierre" }));
    await screen.findByRole("heading", { name: "Turno cerrado" });
    expect(screen.queryByText(/Diferencia/)).not.toBeInTheDocument();
    expect(api.closeCashShift).toHaveBeenCalledWith({ expectedVersion: cashShiftContext.shift!.version, declarations: paymentMethods.map((method) => ({ methodCode: method.code, declaredInCents: 1000 })) });
  });

  it.each([
    { label: "Venta rápida", serviceType: "quick" as const, scheduled: false },
    { label: "Para llevar", serviceType: "takeaway" as const, scheduled: false },
    { label: "Programar pedido", serviceType: "takeaway" as const, scheduled: true },
  ])("selecciona un cliente frecuente en $label y guarda su identificador", async ({ label, serviceType, scheduled }) => {
    storeTerminal();
    const customer = { id: "customer-ana", name: "Ana López", phone: "3331234567", address: "El Salto 6", notes: null,
      active: true, version: 0, createdAt: "2026-10-28T12:00:00Z" };
    const clientSession = { ...session, user: { ...session.user, permissions: [...session.user.permissions, "customers.read", "customers.manage"] } };
    let current: ServiceAccount = { ...emptyAccount, serviceType, tableId: null, tableName: null, customerId: null };
    const date = "2099-10-24T18:30";
    const api = createApi({ login: vi.fn().mockResolvedValue(clientSession), customers: vi.fn().mockResolvedValue([customer]),
      account: vi.fn().mockImplementation(async () => current),
      updateAccountDetails: vi.fn().mockImplementation(async (_id, input) => {
        current = { ...current, ...input, version: current.version + 1 };
        return { accountVersion: current.version };
      }),
    });
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(label) }));
    if (!scheduled) fireEvent.click(await screen.findByRole("button", { name: "Cliente y programación" }));
    await screen.findByRole("option", { name: "Ana López · 3331234567" });
    fireEvent.change(screen.getByLabelText("Cliente frecuente"), { target: { value: customer.id } });
    expect(screen.getByLabelText("Nombre del cliente (opcional)")).toHaveValue("Ana López");
    if (scheduled) fireEvent.change(screen.getByLabelText("Fecha y hora de envío a cocina"), { target: { value: date } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos" }));
    await waitFor(() => expect(api.updateAccountDetails).toHaveBeenCalledWith("account-1", {
      expectedVersion: 0, customerId: customer.id, customerName: customer.name,
      ...(scheduled ? { scheduledFor: new Date(date).toISOString() } : {}),
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cliente y programación" })).not.toBeInTheDocument());
    expect(screen.getByText("Ana López", { selector: ".order-details-summary strong" })).toBeInTheDocument();
    expect(api.checkoutAccount).not.toHaveBeenCalled();
  });

  it("borra los importes y paneles del administrador al cambiar a cajero", async () => {
    storeTerminal();
    const cashier = { ...session, user: { ...session.user, displayName: "Cajero", permissions: ["cash.shift.read", "cash.shift.close", "sales.payment.capture"] } };
    const api = createApi({ login: vi.fn().mockResolvedValueOnce(session).mockResolvedValueOnce(cashier) });
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Caja y corte" }));
    await screen.findByText("Efectivo teórico");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión de Administrador" }));
    fireEvent.change(await screen.findByLabelText("PIN"), { target: { value: "3456" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    await screen.findByRole("button", { name: "Cerrar sesión de Cajero" });
    expect(screen.queryByRole("dialog", { name: "Caja y corte" })).not.toBeInTheDocument();
    expect(screen.queryByText("Efectivo teórico")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Caja y corte" }));
    await screen.findByRole("heading", { name: "Declaración y cierre" });
    expect(api.currentCashReport).toHaveBeenCalledTimes(1);
    expect(api.recentReceipts).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Declarado Efectivo")).toHaveValue(null);
    expect(screen.queryByText("Efectivo teórico")).not.toBeInTheDocument();
  });

  it("muestra al administrador quién declaró y si coincide con el dinero registrado", async () => {
    storeTerminal();
    const admin = { ...session, user: { ...session.user, permissions: [...session.user.permissions, "cash.shift.reconcile"] } };
    const api = createApi({ login: vi.fn().mockResolvedValue(admin), cashShiftCloses: vi.fn().mockResolvedValue([{
      id: "close-1", status: "closed", closedAt: "2030-01-01T13:00:00Z", report: cashReport,
      closedBy: { id: "cashier-1", displayName: "Cajero de turno" }, declarations: [{
        method: paymentMethods[0], theoreticalInCents: 54620, declaredInCents: 54000, differenceInCents: -620,
      }],
    }]) });
    render(<RemotePosApp api={api} />);
    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Caja y corte" }));
    await screen.findByRole("region", { name: "Conciliación de cortes" });
    expect(screen.getByText("Cajero: Cajero de turno")).toBeInTheDocument();
    expect(screen.getByText("Registrado: $546.20")).toBeInTheDocument();
    expect(screen.getByText("Declarado: $540.00")).toBeInTheDocument();
    expect(screen.getByText("Diferencia: -$6.20")).toBeInTheDocument();
  });

});
