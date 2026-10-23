import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryPanel } from "./DeliveryPanel";
import type { ServiceAccount } from "./api/types";
import type { DeliveryAssignment, DeliveryDriver, DeliveryPanelProps } from "./delivery";

const driver: DeliveryDriver = { id: "driver-1", name: "Luis", phone: "5551234567", active: true };
const account: ServiceAccount = {
  id: "account-1", tableId: null, tableName: null, serviceType: "takeaway", status: "open",
  reference: "Pedido para llevar", customerName: "Ana López", guestCount: 1, version: 7,
  accountGroupId: "account-1", isPrimary: true, responsible: { id: "user-1", displayName: "Mesero" },
  items: [{
    id: "item-1", productId: "product-1", productName: "Flauta", unitPriceInCents: 3500,
    modifierTotalInCents: 0, quantity: 2, note: "Salsa aparte", preparationState: "sent",
    modifiers: [{ id: "mod-1", modifierId: "mod-1", name: "Con todo", quantity: 1, priceDeltaInCents: 0 }],
    adjustmentInCents: 0, taxInCents: 966, lineTotalInCents: 7000,
  }],
  adjustments: [],
  totals: { itemTotalInCents: 7000, subtotalInCents: 6034, discountInCents: 0, adjustmentTotalInCents: 0, taxInCents: 966, totalInCents: 7000 },
  totalInCents: 7000,
};

const assignment: DeliveryAssignment = {
  id: "delivery-1", accountId: account.id, driverId: driver.id, driverName: driver.name,
  driverPhone: driver.phone, status: "assigned", version: 4, accountVersion: account.version,
  customerName: account.customerName!, phone: "5559876543", address: "Calle 3 #20", notes: "Puerta azul",
  createdAt: "2026-10-23T12:00:00.000Z", updatedAt: "2026-10-23T12:00:00.000Z",
  shareExpiresAt: null, accountChanged: false, accountUnavailable: false,
  snapshot: {
    accountId: account.id, label: "Pedido para llevar", customerName: account.customerName!, totalInCents: 7000,
    items: [{ productName: "Flauta", quantity: 2, note: "Salsa aparte", modifiers: ["Con todo"], lineTotalInCents: 7000 }],
  },
};

type Api = DeliveryPanelProps["api"];
const createApi = (overrides: Partial<Api> = {}): Api => ({
  deliveryDrivers: vi.fn().mockResolvedValue([driver]),
  createDeliveryDriver: vi.fn().mockResolvedValue({ driver }),
  deliveryAssignments: vi.fn().mockResolvedValue([assignment]),
  assignDelivery: vi.fn().mockResolvedValue({ assignment }),
  updateDeliveryStatus: vi.fn().mockResolvedValue({ assignment }),
  refreshDelivery: vi.fn().mockResolvedValue({ assignment }),
  shareDelivery: vi.fn().mockResolvedValue({ token: "a".repeat(43), expiresAt: "2099-01-01T00:00:00.000Z", version: 5 }),
  account: vi.fn().mockResolvedValue(account),
  ...overrides,
});

const openSelected = async (api: Api) => {
  render(<DeliveryPanel api={api} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Ana López/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Generar enlace para teléfono" })).toBeEnabled());
};

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe("asignación y consulta de repartos", () => {
  it("exige repartidor y dirección y envía la versión de cuenta para obtener la comanda del servidor", async () => {
    const api = createApi({ deliveryAssignments: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([assignment]) });
    render(<DeliveryPanel api={api} account={account} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Actualizar lista" })).toBeEnabled());
    const assign = screen.getByRole("button", { name: "Asignar al repartidor" });
    expect(screen.getByLabelText("Repartidor", { exact: true })).toBeRequired();
    expect(screen.getByLabelText("Dirección de entrega")).toBeRequired();
    expect(assign).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Dirección de entrega"), { target: { value: " Calle 3 #20 " } });
    fireEvent.change(screen.getByLabelText("Repartidor", { exact: true }), { target: { value: "" } });
    expect(assign).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Repartidor", { exact: true }), { target: { value: driver.id } });
    fireEvent.change(screen.getByLabelText("Teléfono del cliente (opcional)"), { target: { value: " 5559876543 " } });
    fireEvent.change(screen.getByLabelText("Indicaciones para el repartidor (opcional)"), { target: { value: " Puerta azul " } });
    fireEvent.click(assign);

    await waitFor(() => expect(api.assignDelivery).toHaveBeenCalledWith({
      accountId: account.id, expectedAccountVersion: 7, driverId: driver.id, customerName: "Ana López",
      phone: "5559876543", address: "Calle 3 #20", notes: "Puerta azul",
    }));
    const details = within(await screen.findByRole("region", { name: "Detalle del reparto" }));
    expect(details.getByText("2 × Flauta")).toBeInTheDocument();
    expect(details.getByText("Con todo")).toBeInTheDocument();
    expect(details.getByText("Nota: Salsa aparte")).toBeInTheDocument();
    expect(details.getByText("Indicaciones: Puerta azul")).toBeInTheDocument();
    expect(details.getByText(/Total del pedido:.*70\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Este pedido ya tiene un reparto activo/)).toBeInTheDocument();
  });

  it("impide asignar una cuenta vacía o con todos los productos cancelados", async () => {
    const api = createApi({ deliveryAssignments: vi.fn().mockResolvedValue([]) });
    const cancelledAccount: ServiceAccount = { ...account, items: account.items.map((item) => ({ ...item, preparationState: "cancelled" })) };
    const { rerender } = render(<DeliveryPanel api={api} account={{ ...account, items: [] }} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Actualizar lista" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Dirección de entrega"), { target: { value: "Calle 3" } });
    expect(screen.getByRole("button", { name: "Asignar al repartidor" })).toBeDisabled();
    rerender(<DeliveryPanel api={api} account={cancelledAccount} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Asignar al repartidor" })).toBeDisabled();
    expect(api.assignDelivery).not.toHaveBeenCalled();
  });

  it("registra al repartidor y permite seleccionarlo para el pedido", async () => {
    const api = createApi({ deliveryDrivers: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([driver]), deliveryAssignments: vi.fn().mockResolvedValue([]) });
    render(<DeliveryPanel api={api} account={account} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Actualizar lista" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Nombre del repartidor"), { target: { value: " Luis " } });
    fireEvent.change(screen.getByLabelText("Teléfono del repartidor (opcional)"), { target: { value: " 5551234567 " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar repartidor" }));
    await waitFor(() => expect(api.createDeliveryDriver).toHaveBeenCalledWith({ name: "Luis", phone: "5551234567" }));
    await waitFor(() => expect(screen.getByLabelText("Repartidor", { exact: true })).toHaveValue(driver.id));
    expect(screen.getByLabelText("Nombre del repartidor")).toHaveValue("");
  });

  it("genera un enlace con token en el fragmento, sin sesión ni parámetros del POS", async () => {
    const api = createApi();
    const persist = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log");
    await openSelected(api);
    fireEvent.change(screen.getByLabelText("Dirección del sistema para el teléfono"), { target: { value: "http://192.168.1.20:8080/pos?session=do-not-share" } });
    fireEvent.click(screen.getByRole("button", { name: "Generar enlace para teléfono" }));

    const input = await screen.findByLabelText("Enlace de la comanda");
    const url = new URL((input as HTMLInputElement).value);
    expect(api.shareDelivery).toHaveBeenCalledWith(assignment.id, 4);
    expect(url.origin).toBe("http://192.168.1.20:8080");
    expect(url.pathname).toBe("/reparto");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe("a".repeat(43));
    expect(url.toString()).not.toContain("session");
    expect(screen.getByRole("link", { name: "Abrir comanda" })).toHaveAttribute("rel", "noreferrer");
    expect(screen.getByText(/vence en 72 horas/)).toBeInTheDocument();
    expect(screen.getByText(/Renovarlo invalida el enlace anterior/)).toBeInTheDocument();
    expect(persist).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "https://usuario:secreto@example.com"])("rechaza la dirección no permitida %s antes de emitir un token", async (baseUrl) => {
    const api = createApi();
    await openSelected(api);
    fireEvent.change(screen.getByLabelText("Dirección del sistema para el teléfono"), { target: { value: baseUrl } });
    fireEvent.click(screen.getByRole("button", { name: "Generar enlace para teléfono" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe la dirección del sistema");
    expect(api.shareDelivery).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Enlace de la comanda")).not.toBeInTheDocument();
  });

  it("bloquea compartir una comanda modificada y usa ambas versiones al actualizarla", async () => {
    const changed = { ...assignment, accountChanged: true };
    const refreshed = { ...assignment, version: 5, accountVersion: 12, accountChanged: false };
    const api = createApi({
      deliveryAssignments: vi.fn().mockResolvedValueOnce([changed]).mockResolvedValue([refreshed]),
      account: vi.fn().mockResolvedValue({ ...account, version: 12 }),
      refreshDelivery: vi.fn().mockResolvedValue({ assignment: refreshed }),
    });
    render(<DeliveryPanel api={api} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Ana López/ }));
    expect(screen.getByRole("button", { name: "Generar enlace para teléfono" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Marcar en camino" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("La cuenta cambió");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar comanda" }));

    await waitFor(() => expect(api.account).toHaveBeenCalledWith(account.id));
    expect(api.refreshDelivery).toHaveBeenCalledWith(assignment.id, { expectedVersion: 4, expectedAccountVersion: 12 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Generar enlace para teléfono" })).toBeEnabled());
    expect(api.shareDelivery).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Enlace de la comanda")).not.toBeInTheDocument();
  });

  it("permite cancelar el reparto de un pedido anulado sin ofrecer actualizar ni compartir", async () => {
    const unavailable = { ...assignment, accountChanged: true, accountUnavailable: true };
    const api = createApi({ deliveryAssignments: vi.fn().mockResolvedValue([unavailable]) });
    render(<DeliveryPanel api={api} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Ana López/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("ya no se puede repartir");
    expect(screen.queryByRole("button", { name: "Actualizar comanda" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar enlace para teléfono" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Marcar en camino" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar reparto" })).toBeEnabled();
  });

  it("actualiza la comanda de un reparto entregado cuando la cuenta se cobró después", async () => {
    const changed: DeliveryAssignment = { ...assignment, status: "delivered", accountChanged: true };
    const refreshed: DeliveryAssignment = { ...changed, version: 5, accountVersion: 12, accountChanged: false };
    const api = createApi({
      deliveryAssignments: vi.fn().mockResolvedValueOnce([changed]).mockResolvedValue([refreshed]),
      account: vi.fn().mockResolvedValue({ ...account, status: "closed", version: 12 }),
      refreshDelivery: vi.fn().mockResolvedValue({ assignment: refreshed }),
    });
    render(<DeliveryPanel api={api} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Actualizar lista" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Mostrar"), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: /^Ana López/ }));
    expect(screen.getByRole("button", { name: "Generar enlace para teléfono" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar comanda" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Generar enlace para teléfono" })).toBeEnabled());
    expect(api.refreshDelivery).toHaveBeenCalledWith(assignment.id, { expectedVersion: 4, expectedAccountVersion: 12 });
    expect(api.updateDeliveryStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Marcar en camino" })).not.toBeInTheDocument();
  });

  it("avanza a en camino y entregado sin registrar pagos del cliente", async () => {
    let current = assignment;
    const checkoutAccount = vi.fn();
    const api = {
      ...createApi({
        deliveryAssignments: vi.fn(async () => [current]),
        updateDeliveryStatus: vi.fn(async (_id, input) => {
          current = { ...current, status: input.status, version: current.version + 1 };
          return { assignment: current };
        }),
      }), checkoutAccount,
    };
    await openSelected(api);
    fireEvent.click(screen.getByRole("button", { name: "Marcar en camino" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Marcar entregado" })).toBeEnabled());
    expect(api.updateDeliveryStatus).toHaveBeenNthCalledWith(1, assignment.id, { expectedVersion: 4, status: "out_for_delivery" });
    fireEvent.click(screen.getByRole("button", { name: "Marcar entregado" }));
    await waitFor(() => expect(api.updateDeliveryStatus).toHaveBeenNthCalledWith(2, assignment.id, { expectedVersion: 5, status: "delivered" }));
    expect(await screen.findByText("Reparto entregado. Los cobros se registran en caja.")).toBeInTheDocument();
    expect(screen.getByText(/Marcar entregado no registra el cobro/)).toBeInTheDocument();
    expect(checkoutAccount).not.toHaveBeenCalled();
  });

  it("retira el enlace anterior y bloquea entregar cuando la lista detecta cambios en la cuenta", async () => {
    let current = { ...assignment, status: "out_for_delivery" as const };
    const api = createApi({ deliveryAssignments: vi.fn(async () => [current]) });
    await openSelected(api);
    fireEvent.click(screen.getByRole("button", { name: "Generar enlace para teléfono" }));
    expect(await screen.findByLabelText("Enlace de la comanda")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Actualizar lista" })).toBeEnabled());
    current = { ...current, accountChanged: true };
    fireEvent.click(screen.getByRole("button", { name: "Actualizar lista" }));

    await waitFor(() => expect(screen.queryByLabelText("Enlace de la comanda")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Marcar entregado" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Generar enlace para teléfono" })).toBeDisabled();
    expect(api.updateDeliveryStatus).not.toHaveBeenCalled();
  });

  it("cancela el reparto y retira el enlace compartido", async () => {
    let current = assignment;
    const api = createApi({
      deliveryAssignments: vi.fn(async () => [current]),
      updateDeliveryStatus: vi.fn(async (_id, input) => {
        current = { ...current, status: input.status, version: current.version + 1 };
        return { assignment: current };
      }),
    });
    await openSelected(api);
    fireEvent.click(screen.getByRole("button", { name: "Generar enlace para teléfono" }));
    expect(await screen.findByLabelText("Enlace de la comanda")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar reparto" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar reparto" }));

    expect(await screen.findByText("Reparto cancelado. Los cobros se registran en caja.")).toBeInTheDocument();
    expect(api.updateDeliveryStatus).toHaveBeenCalledWith(assignment.id, { expectedVersion: 4, status: "cancelled" });
    expect(screen.queryByLabelText("Enlace de la comanda")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generar enlace para teléfono" })).not.toBeInTheDocument();
  });
});
