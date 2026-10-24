import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReceiptPrintingStatus, SalesReceipt } from "./api/types";
import { ReceiptPrintControls, type ReceiptPrintingApi } from "./ReceiptPrinting";

const receipt: SalesReceipt = {
  id: "receipt-1", folio: "T-000001", status: "issued", issuedAt: "2026-10-24T18:00:00.000Z",
  shift: { id: "shift-1", register: { id: "register-1", code: "MAIN", name: "Caja principal" } },
  account: {
    id: "account-1", tableId: "table-1", tableName: "Mesa 1", serviceType: "table", status: "paid",
    reference: null, customerName: "Ana López", guestCount: 2, version: 3, accountGroupId: "group-1", isPrimary: true,
    responsible: { id: "user-1", displayName: "Cajero" }, adjustments: [],
    items: [{ id: "item-1", productId: "product-1", productName: "Flauta", quantity: 1, unitPriceInCents: 3500, modifierTotalInCents: 0, note: "Con todo", preparationState: "sent", modifiers: [], adjustmentInCents: 0, taxInCents: 483, lineTotalInCents: 3500 }],
    totals: { itemTotalInCents: 3500, subtotalInCents: 3017, adjustmentTotalInCents: 0, discountInCents: 0, taxInCents: 483, totalInCents: 3500 }, totalInCents: 3500,
  },
  payments: [{ id: "payment-1", method: { id: "cash", code: "CASH", name: "Efectivo", supportsChange: true, requiresReference: false }, amountInCents: 3500, tipInCents: 0, totalInCents: 3500, tenderedInCents: 5000, changeInCents: 1500, reference: null }],
  totals: { saleInCents: 3500, tipInCents: 0, collectedInCents: 3500, changeInCents: 1500 },
};

const printing = (status?: ReceiptPrintingStatus["jobs"][number]["status"]): ReceiptPrintingStatus => ({
  receiptId: receipt.id, receiptStatus: "issued",
  jobs: status ? [{ id: "job-1", kind: "receipt", status, attempts: status === "failed" ? 5 : 1, maxAttempts: 5, lastError: status === "failed" ? "Impresora sin conexión" : null, createdAt: receipt.issuedAt, completedAt: status === "completed" ? receipt.issuedAt : null }] : [],
  routing: { registerCode: "MAIN", registerName: "Caja principal", configuredAgentCount: 1, onlineAgentCount: 1 },
});
const createApi = (overrides: Partial<ReceiptPrintingApi> = {}): ReceiptPrintingApi => ({
  receipt: vi.fn().mockResolvedValue(receipt),
  receiptPrinting: vi.fn().mockResolvedValue(printing()),
  printReceipt: vi.fn().mockResolvedValue({ jobId: "job-1", receiptId: receipt.id, status: "queued", created: true, requeued: false }),
  reprintReceipt: vi.fn().mockResolvedValue({ jobId: "copy-1" }),
  ...overrides,
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("ReceiptPrintControls", () => {
  it("envía el ticket original y muestra el estado sin generar una reimpresión", async () => {
    const api = createApi();
    const busy = vi.fn();
    render(<ReceiptPrintControls api={api} receipt={receipt} canPrint canReprint onBusyChange={busy} />);
    await screen.findByText("Ticket sin envío registrado");
    fireEvent.click(screen.getByRole("button", { name: "Imprimir ticket" }));
    await waitFor(() => expect(api.printReceipt).toHaveBeenCalledWith(receipt.id));
    expect(await screen.findByText("Ticket enviado a la cola de impresión.")).toBeInTheDocument();
    expect(api.reprintReceipt).not.toHaveBeenCalled();
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });

  it("actualiza una impresión en cola hasta que el agente confirma su envío", async () => {
    vi.useFakeTimers();
    const api = createApi({ receiptPrinting: vi.fn().mockResolvedValueOnce(printing("queued")).mockResolvedValue(printing("completed")) });
    await act(async () => { render(<ReceiptPrintControls api={api} receipt={receipt} canPrint canReprint />); });
    expect(screen.getByText("En cola de impresión")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimir ticket" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reimprimir ticket" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText("Enviado a impresora")).toBeInTheDocument();
    expect(screen.getByText("Envío confirmado; revisa la impresora si no salió papel.")).toBeInTheDocument();
    expect(api.printReceipt).not.toHaveBeenCalled();
    expect(api.reprintReceipt).not.toHaveBeenCalled();
  });

  it("reintenta un fallo con la operación del original y conserva el mensaje del error", async () => {
    const api = createApi({
      receiptPrinting: vi.fn().mockResolvedValue(printing("failed")),
      printReceipt: vi.fn().mockResolvedValue({ jobId: "job-1", receiptId: receipt.id, status: "queued", created: false, requeued: true }),
    });
    render(<ReceiptPrintControls api={api} receipt={receipt} canPrint canReprint />);
    expect(await screen.findByText("Impresora sin conexión")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar impresión" }));
    expect(await screen.findByText("Se reintentará el envío del ticket original.")).toBeInTheDocument();
    expect(api.printReceipt).toHaveBeenCalledWith(receipt.id);
    expect(api.reprintReceipt).not.toHaveBeenCalled();
  });

  it("exige un motivo para una copia adicional y usa la operación de reimpresión", async () => {
    const api = createApi({ receiptPrinting: vi.fn().mockResolvedValue(printing("completed")) });
    render(<ReceiptPrintControls api={api} receipt={receipt} canPrint canReprint />);
    await screen.findByText("Enviado a impresora");
    fireEvent.click(screen.getByRole("button", { name: "Reimprimir ticket" }));
    expect(screen.getByRole("button", { name: "Confirmar reimpresión" })).toBeDisabled();
    expect(api.reprintReceipt).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Motivo de reimpresión"), { target: { value: "  Copia solicitada por el cliente  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reimpresión" }));
    await waitFor(() => expect(api.reprintReceipt).toHaveBeenCalledWith(receipt.id, "Copia solicitada por el cliente"));
    expect(api.printReceipt).not.toHaveBeenCalled();
  });

  it("prepara sólo el recibo vigente para el navegador sin enviar otra impresión al agente", async () => {
    const browserPrint = vi.spyOn(window, "print").mockImplementation(() => {});
    const api = createApi({ receipt: vi.fn().mockResolvedValue({ ...receipt, status: "refunded" }) });
    render(<><p>Información privada de caja</p><ReceiptPrintControls api={api} receipt={receipt} canPrint canReprint canPrintBrowser /></>);
    expect(browserPrint).not.toHaveBeenCalled();
    expect(document.querySelector(".receipt-browser-print")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir desde navegador (80 mm)" }));
    await waitFor(() => expect(browserPrint).toHaveBeenCalledTimes(1));
    expect(api.receipt).toHaveBeenCalledWith(receipt.id);
    const paper = document.querySelector<HTMLElement>("body > .receipt-browser-print")!;
    expect(within(paper).getByText("COPIA DESDE NAVEGADOR")).toBeInTheDocument();
    expect(within(paper).getByText("VENTA DEVUELTA")).toBeInTheDocument();
    expect(within(paper).getByText("Cliente: Ana López")).toBeInTheDocument();
    expect(within(paper).getByText("Con todo")).toBeInTheDocument();
    expect(within(paper).queryByText("Información privada de caja")).not.toBeInTheDocument();
    expect(paper.querySelector("[id]")).toBeNull();
    expect(api.printReceipt).not.toHaveBeenCalled();
    expect(api.reprintReceipt).not.toHaveBeenCalled();
    fireEvent(window, new Event("afterprint"));
    expect(document.querySelector(".receipt-browser-print")).toBeNull();
  });

  it("impide imprimir una copia desactualizada si falla la consulta del ticket", async () => {
    const browserPrint = vi.spyOn(window, "print").mockImplementation(() => {});
    const api = createApi({ receipt: vi.fn().mockRejectedValue(new Error("No se pudo consultar el ticket")) });
    render(<ReceiptPrintControls api={api} receipt={receipt} canPrint canReprint canPrintBrowser />);
    fireEvent.click(screen.getByRole("button", { name: "Imprimir desde navegador (80 mm)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo consultar el ticket");
    expect(browserPrint).not.toHaveBeenCalled();
    expect(document.querySelector(".receipt-browser-print")).toBeNull();
  });

  it("respeta el permiso independiente de reimpresión", async () => {
    const api = createApi({ receiptPrinting: vi.fn().mockResolvedValue(printing("completed")) });
    render(<ReceiptPrintControls api={api} receipt={receipt} canPrint canReprint={false} />);
    await screen.findByText("Enviado a impresora");
    expect(screen.queryByRole("button", { name: "Reimprimir ticket" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Motivo de reimpresión")).not.toBeInTheDocument();
  });

  it("oculta el respaldo del navegador sin permiso para consultar recibos", async () => {
    const api = createApi();
    render(<ReceiptPrintControls api={api} receipt={receipt} canPrint canReprint canPrintBrowser={false} />);
    await screen.findByText("Ticket sin envío registrado");
    expect(screen.queryByRole("button", { name: "Imprimir desde navegador (80 mm)" })).not.toBeInTheDocument();
    expect(api.receipt).not.toHaveBeenCalled();
  });
});
