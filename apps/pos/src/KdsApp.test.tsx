import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KdsApp, type KdsApi } from "./KdsApp";
import type { ProductionTicket, Session, TerminalCredentials } from "./api/types";

const terminal: TerminalCredentials = {
  id: "kds-terminal-1",
  deviceToken: "kds-device-token",
  displayName: "Pantalla cocina",
};

const session: Session = {
  accessToken: "kds-session-token",
  expiresAt: "2030-01-01T00:00:00.000Z",
  user: { id: "user-1", displayName: "Administrador", permissions: [] },
};

const pendingTicket: ProductionTicket = {
  id: "ticket-1",
  accountId: "account-1",
  roundId: "round-1",
  center: { id: "center-1", code: "KITCHEN", name: "Cocina" },
  kind: "addition",
  roundSequence: 1,
  status: "pending",
  version: 0,
  service: { type: "table", label: "Mesa 1" },
  createdAt: new Date().toISOString(),
  startedAt: null,
  readyAt: null,
  items: [{
    id: "ticket-item-1",
    orderItemId: "item-1",
    productName: "Taco al pastor",
    quantity: 2,
    note: "Bien dorado",
    modifiers: ["Sin cebolla"],
  }],
};

const createApi = (overrides: Partial<KdsApi> = {}): KdsApi => ({
  setAccessToken: vi.fn(),
  registerTerminal: vi.fn().mockResolvedValue(terminal),
  login: vi.fn().mockResolvedValue(session),
  productionTickets: vi.fn().mockResolvedValue([pendingTicket]),
  transitionProductionTicket: vi.fn().mockResolvedValue({
    ticketId: pendingTicket.id,
    status: "in_progress",
    version: 1,
  }),
  reprintProductionTicket: vi.fn().mockResolvedValue({
    jobId: "reprint-1",
    ticketId: pendingTicket.id,
  }),
  ...overrides,
});

const storeTerminal = () => {
  window.localStorage.setItem(
    "antojit-os.kds-terminal.v1",
    JSON.stringify(terminal),
  );
};

const login = async (api: KdsApi) => {
  render(<KdsApp api={api} />);
  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "1234" } });
  fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
  await screen.findByText("Taco al pastor");
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("pantalla KDS", () => {
  it("registra una terminal con perfil de producción", async () => {
    const api = createApi();
    render(<KdsApp api={api} />);
    fireEvent.change(screen.getByLabelText("Token de instalación"), {
      target: { value: "bootstrap-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar KDS" }));

    expect(await screen.findByRole("heading", { name: "Acceso a producción" })).toBeInTheDocument();
    expect(api.registerTerminal).toHaveBeenCalledWith({
      bootstrapToken: "bootstrap-secret",
      terminalCode: "KDS-01",
      displayName: "Pantalla cocina",
      profile: "kds",
    });
  });

  it("muestra una comanda y avanza su estado con un toque", async () => {
    storeTerminal();
    const updated = { ...pendingTicket, status: "in_progress" as const, version: 1 };
    const productionTickets = vi.fn()
      .mockResolvedValueOnce([pendingTicket])
      .mockResolvedValueOnce([updated]);
    const api = createApi({ productionTickets });
    await login(api);

    expect(screen.getByText(/Sin cebolla/)).toBeInTheDocument();
    expect(screen.getByText(/Bien dorado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Comenzar" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Marcar listo" })).toBeInTheDocument());
    expect(api.transitionProductionTicket).toHaveBeenCalledWith("ticket-1", {
      status: "in_progress",
      expectedVersion: 0,
    });
  });

  it("exige un motivo antes de solicitar reimpresión", async () => {
    storeTerminal();
    const api = createApi();
    await login(api);
    fireEvent.click(screen.getByRole("button", { name: "Reimprimir" }));

    const submit = screen.getByRole("button", { name: "Solicitar reimpresión" });
    expect(submit).toBeDisabled();
    expect(screen.getByRole("button", { name: "Error" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Falta de papel" }));
    expect(screen.getByLabelText("Motivo de la reimpresión")).toHaveValue("Falta de papel");
    expect(api.reprintProductionTicket).not.toHaveBeenCalled();
    fireEvent.click(submit);

    await waitFor(() => expect(api.reprintProductionTicket).toHaveBeenCalledWith(
      "ticket-1",
      "Falta de papel",
    ));
  });
});
