import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemotePosApp, type RemoteApi } from "./RemotePosApp";
import type {
  CashShiftContext,
  CatalogCategory,
  PaymentMethod,
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
      "service.account.manage",
      "service.account.discount",
      "service.precheck.create",
      "cash.shift.read",
      "cash.shift.open",
      "sales.payment.capture",
      "sales.receipt.read",
    ],
  },
};

const catalog: CatalogCategory[] = [{
  id: "category-1",
  code: "ANTOJITOS",
  name: "Antojitos",
  color: "amber",
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

const createApi = (overrides: Partial<RemoteApi> = {}): RemoteApi => ({
  setAccessToken: vi.fn(),
  registerTerminal: vi.fn().mockResolvedValue(terminal),
  login: vi.fn().mockResolvedValue(session),
  catalog: vi.fn().mockResolvedValue(catalog),
  serviceLayout: vi.fn().mockResolvedValue(layout),
  openAccount: vi.fn().mockResolvedValue({ id: "account-1" }),
  account: vi.fn().mockResolvedValue(emptyAccount),
  tableAccounts: vi.fn().mockResolvedValue([]),
  accountManagementOptions: vi.fn().mockResolvedValue({
    users: [{ id: "user-1", displayName: "Administrador" }],
    tables: [{ id: "table-1", name: "Mesa 1" }],
    accounts: [],
  }),
  currentCashShift: vi.fn().mockResolvedValue(cashShiftContext),
  openCashShift: vi.fn().mockResolvedValue(cashShiftContext),
  paymentMethods: vi.fn().mockResolvedValue(paymentMethods),
  checkoutAccount: vi.fn().mockResolvedValue(paidReceipt),
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
  cancelAccount: vi.fn().mockResolvedValue({ accountVersion: 1, status: "cancelled" }),
  addItem: vi.fn().mockResolvedValue({ accountVersion: 1 }),
  updateItem: vi.fn().mockResolvedValue({ accountVersion: 2 }),
  cancelItem: vi.fn().mockResolvedValue({ accountVersion: 2, state: "cancelled" }),
  sendRound: vi.fn().mockResolvedValue({ roundId: "round-1", accountVersion: 2 }),
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
  await screen.findByRole("heading", { name: "Mesa 1" });
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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

  it("agrega un producto y envía la ronda al servidor", async () => {
    storeTerminal();
    const accountMock = vi.fn()
      .mockResolvedValueOnce(emptyAccount)
      .mockResolvedValueOnce(pendingAccount)
      .mockResolvedValueOnce(sentAccount);
    const api = createApi({ account: accountMock });
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
    fireEvent.change(screen.getByLabelText("Motivo para liberar la mesa"), {
      target: { value: "Mesa abierta por error" },
    });
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
});
