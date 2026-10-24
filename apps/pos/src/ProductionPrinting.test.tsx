import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductionPrintResult, ProductionTicket } from "./api/types";
import { ProductionPrintControls, type ProductionPrintingApi } from "./ProductionPrinting";

const ticket: ProductionTicket = {
  id: "ticket-1", accountId: "account-1", roundId: "round-1",
  center: { id: "center-1", code: "KITCHEN", name: "Cocina" },
  kind: "addition", roundSequence: 1, status: "delivered", version: 3,
  service: { type: "table", label: "Mesa 1" },
  createdAt: "2026-10-24T18:00:00.000Z", startedAt: null, readyAt: null,
  printStatus: "completed", printLastError: null,
  items: [{ id: "ticket-item-1", orderItemId: "item-1", productName: "Taco al pastor", quantity: 2, note: null, modifiers: [] }],
};
const printResult: ProductionPrintResult = {
  jobId: "job-1", ticketId: ticket.id, status: "queued", created: true, requeued: false,
};
const createApi = (overrides: Partial<ProductionPrintingApi> = {}): ProductionPrintingApi => ({
  accountProductionTickets: vi.fn().mockResolvedValue([ticket]),
  printProductionTicket: vi.fn().mockResolvedValue(printResult),
  ...overrides,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("ProductionPrintControls", () => {
  it("consulta las comandas al abrir y actualizar la cuenta sin solicitar otra impresión", async () => {
    const cancellation = { ...ticket, id: "ticket-2", roundSequence: 2, kind: "cancellation" as const, printStatus: "cancelled" as const };
    const api = createApi({ accountProductionTickets: vi.fn().mockResolvedValue([ticket, cancellation]) });
    const { rerender } = render(<ProductionPrintControls api={api} accountId="account-1" accountVersion={3} />);
    expect(await screen.findByText("Ronda #1 · Cocina")).toBeInTheDocument();
    expect(screen.getByText("Ronda #2 · Cocina · Cancelación")).toBeInTheDocument();
    expect(screen.getByText("Se imprimen automáticamente al enviarlas.")).toBeInTheDocument();
    expect(screen.getByText("Envío confirmado; revisa la impresora si no salió papel.")).toBeInTheDocument();
    expect(screen.getByText("Impresión cancelada")).toBeInTheDocument();
    expect(api.accountProductionTickets).toHaveBeenCalledWith("account-1");
    rerender(<ProductionPrintControls api={api} accountId="account-1" accountVersion={4} />);
    await waitFor(() => expect(api.accountProductionTickets).toHaveBeenCalledTimes(2));
    expect(api.printProductionTicket).not.toHaveBeenCalled();
  });

  it("oculta la sección cuando la cuenta todavía no tiene comandas", async () => {
    const api = createApi({ accountProductionTickets: vi.fn().mockResolvedValue([]) });
    render(<ProductionPrintControls api={api} accountId="account-1" accountVersion={1} />);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Impresión de comandas" })).not.toBeInTheDocument());
    expect(api.accountProductionTickets).toHaveBeenCalledOnce();
    expect(api.printProductionTicket).not.toHaveBeenCalled();
  });

  it("solicita una copia al pulsar Imprimir comanda y conserva el estado de envío", async () => {
    const api = createApi({
      accountProductionTickets: vi.fn().mockResolvedValueOnce([ticket]).mockResolvedValue([{ ...ticket, printStatus: "queued" }]),
    });
    const busy = vi.fn();
    render(<ProductionPrintControls api={api} accountId="account-1" accountVersion={3} onBusyChange={busy} />);
    fireEvent.click(await screen.findByRole("button", { name: /Imprimir comanda de la ronda 1, Cocina/ }));
    expect(await screen.findByText("Copia de la comanda enviada a la cola de impresión.")).toBeInTheDocument();
    expect(api.printProductionTicket).toHaveBeenCalledExactlyOnceWith(ticket.id);
    expect(screen.getByText("En cola de impresión")).toBeInTheDocument();
    expect(screen.queryByText("Enviado a impresora")).not.toBeInTheDocument();
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it.each([
    ["queued", "La comanda ya está en la cola de impresión."],
    ["claimed", "La comanda ya se está enviando a la impresora."],
  ] as const)("permite pedir una impresión %s y avisa que se conserva el envío pendiente", async (status, notice) => {
    const api = createApi({
      accountProductionTickets: vi.fn().mockResolvedValue([{ ...ticket, printStatus: status }]),
      printProductionTicket: vi.fn().mockResolvedValue({ ...printResult, status, created: false }),
    });
    render(<ProductionPrintControls api={api} accountId="account-1" accountVersion={3} />);
    const button = await screen.findByRole("button", { name: /Imprimir comanda/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(api.printProductionTicket).toHaveBeenCalledExactlyOnceWith(ticket.id);
    expect(screen.queryByText("Copia de la comanda enviada a la cola de impresión.")).not.toBeInTheDocument();
  });

  it("muestra el error de la impresora y permite reintentar después de un error de conexión", async () => {
    const failedTicket = { ...ticket, printStatus: "failed" as const, printLastError: "Impresora sin conexión" };
    const api = createApi({
      accountProductionTickets: vi.fn().mockResolvedValue([failedTicket]),
      printProductionTicket: vi.fn()
        .mockRejectedValueOnce(new Error("No se pudo conectar con caja"))
        .mockResolvedValue({ ...printResult, created: false, requeued: true }),
    });
    render(<ProductionPrintControls api={api} accountId="account-1" accountVersion={3} />);
    expect(await screen.findByText("Impresora sin conexión")).toBeInTheDocument();
    expect(screen.getByText("Error de impresión")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Imprimir comanda/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar con caja");
    expect(screen.getByRole("button", { name: /Imprimir comanda/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Imprimir comanda/ }));
    expect(await screen.findByText("Se reintentará el envío de la comanda.")).toBeInTheDocument();
    expect(api.printProductionTicket).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("consulta cada dos segundos los envíos pendientes del historial y se detiene al completarse", async () => {
    vi.useFakeTimers();
    const api = createApi({
      accountProductionTickets: vi.fn()
        .mockResolvedValueOnce([{ ...ticket, printStatus: "queued" }])
        .mockResolvedValueOnce([{ ...ticket, printStatus: "claimed" }])
        .mockResolvedValue([ticket]),
    });
    await act(async () => { render(<ProductionPrintControls api={api} accountId="account-1" accountVersion={3} />); });
    expect(screen.getByText("En cola de impresión")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(api.accountProductionTickets).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText("Enviando a impresora")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText("Enviado a impresora")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(api.accountProductionTickets).toHaveBeenCalledTimes(3);
    expect(api.printProductionTicket).not.toHaveBeenCalled();
  });

  it("cancela la consulta programada al cerrar la comanda", async () => {
    vi.useFakeTimers();
    const api = createApi({ accountProductionTickets: vi.fn().mockResolvedValue([{ ...ticket, printStatus: "queued" }]) });
    let unmount!: () => void;
    await act(async () => { ({ unmount } = render(<ProductionPrintControls api={api} accountId="account-1" accountVersion={3} />)); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.accountProductionTickets).toHaveBeenCalledOnce();
  });

  it("ignora respuestas de consultas anteriores al cambiar de cuenta", async () => {
    const previous = deferred<ProductionTicket[]>();
    const current = { ...ticket, id: "ticket-2", accountId: "account-2", roundSequence: 2, printStatus: null };
    const api = createApi({ accountProductionTickets: vi.fn().mockReturnValueOnce(previous.promise).mockResolvedValue([current]) });
    const { rerender } = render(<ProductionPrintControls api={api} accountId="account-1" accountVersion={1} />);
    rerender(<ProductionPrintControls api={api} accountId="account-2" accountVersion={1} />);
    expect(await screen.findByText("Ronda #2 · Cocina")).toBeInTheDocument();
    await act(async () => { previous.resolve([ticket]); });
    expect(screen.queryByText("Ronda #1 · Cocina")).not.toBeInTheDocument();
    expect(screen.getByText("Sin envío registrado")).toBeInTheDocument();
    expect(api.printProductionTicket).not.toHaveBeenCalled();
  });

  it("evita el doble clic y descarta la respuesta de impresión al cambiar de cuenta", async () => {
    const pending = deferred<ProductionPrintResult>();
    const nextTicket = { ...ticket, id: "ticket-2", accountId: "account-2", roundSequence: 2 };
    const api = createApi({
      accountProductionTickets: vi.fn().mockImplementation((accountId: string) => Promise.resolve(accountId === "account-1" ? [ticket] : [nextTicket])),
      printProductionTicket: vi.fn().mockReturnValue(pending.promise),
    });
    const busy = vi.fn();
    const { rerender } = render(<ProductionPrintControls api={api} accountId="account-1" accountVersion={3} onBusyChange={busy} />);
    const button = await screen.findByRole("button", { name: /Imprimir comanda/ });
    act(() => { button.click(); button.click(); });
    expect(api.printProductionTicket).toHaveBeenCalledExactlyOnceWith(ticket.id);
    expect(button).toBeDisabled();
    rerender(<ProductionPrintControls api={api} accountId="account-2" accountVersion={3} onBusyChange={busy} />);
    expect(await screen.findByText("Ronda #2 · Cocina")).toBeInTheDocument();
    await act(async () => { pending.resolve(printResult); });
    expect(screen.queryByText("Copia de la comanda enviada a la cola de impresión.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Imprimir comanda/ })).toBeEnabled();
    expect(api.accountProductionTickets).toHaveBeenCalledTimes(2);
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it("permite recuperar una consulta fallida y respeta el bloqueo de la cuenta", async () => {
    const api = createApi({
      accountProductionTickets: vi.fn().mockRejectedValueOnce(new Error("Servidor sin conexión")).mockResolvedValue([ticket]),
    });
    const { rerender } = render(<ProductionPrintControls api={api} accountId="account-1" accountVersion={3} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo consultar la impresión: Servidor sin conexión");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar impresión" }));
    const button = await screen.findByRole("button", { name: /Imprimir comanda/ });
    rerender(<ProductionPrintControls api={api} accountId="account-1" accountVersion={3} disabled />);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(api.printProductionTicket).not.toHaveBeenCalled();
  });
});
