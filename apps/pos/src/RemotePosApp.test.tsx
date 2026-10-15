import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemotePosApp, type RemoteApi } from "./RemotePosApp";
import type {
  CatalogCategory,
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
  user: { id: "user-1", displayName: "Administrador", permissions: [] },
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
  items: [],
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
    lineTotalInCents: 4200,
  }],
  totalInCents: 4200,
};

const sentAccount: ServiceAccount = {
  ...pendingAccount,
  version: 2,
  items: pendingAccount.items.map((item) => ({ ...item, preparationState: "sent" })),
};

const createApi = (overrides: Partial<RemoteApi> = {}): RemoteApi => ({
  setAccessToken: vi.fn(),
  registerTerminal: vi.fn().mockResolvedValue(terminal),
  login: vi.fn().mockResolvedValue(session),
  catalog: vi.fn().mockResolvedValue(catalog),
  serviceLayout: vi.fn().mockResolvedValue(layout),
  openAccount: vi.fn().mockResolvedValue({ id: "account-1" }),
  account: vi.fn().mockResolvedValue(emptyAccount),
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
});
