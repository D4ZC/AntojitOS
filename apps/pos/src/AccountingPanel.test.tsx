import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountingPanel } from "./AccountingPanel";
import {
  type AccountingApi, type AccountingBill, type AccountingPayment,
  type AccountingSummary, type AccountingSupplier,
  accountingCsv, accountingPesosToCents, accountingToday,
} from "./accounting";

const today = accountingToday();
const supplier: AccountingSupplier = {
  id: "supplier-1", name: "Tortillería Lupita", contactName: "Lupita", phone: "5551234567",
  taxId: null, notes: null, active: true, version: 0, createdAt: "2026-10-01T12:00:00Z",
};
const bill: AccountingBill = {
  id: "bill-1", supplierId: supplier.id, supplierName: supplier.name, description: "Tortillas de la semana",
  amountInCents: 100_000, paidInCents: 0, outstandingInCents: 100_000,
  issuedOn: today, dueOn: null, reference: "Factura 42", version: 0,
  createdAt: "2026-10-01T12:00:00Z", payments: [], voidedAt: null, voidReason: null,
};
const payment: AccountingPayment = {
  id: "payment-1", amountInCents: 25_050, methodCode: "TRANSFER", paidOn: today,
  reference: "Abono 1", source: "external", cashMovementId: null,
  voidedAt: null, voidReason: null, createdAt: "2026-10-01T13:00:00Z",
};
const summary: AccountingSummary = {
  from: `${today.slice(0, 7)}-01`, to: today,
  sales: { grossInCents: 200_000, refundedInCents: 10_000, netInCents: 190_000, receiptCount: 12 },
  expenses: { supplierPaymentsInCents: 50_000, manualCashOutInCents: 10_000, totalInCents: 60_000 },
  balanceInCents: 130_000, outstandingInCents: 100_000,
};
const createApi = (overrides: Partial<AccountingApi> = {}): AccountingApi => ({
  accountingSuppliers: vi.fn().mockResolvedValue({ suppliers: [supplier] }),
  createAccountingSupplier: vi.fn().mockResolvedValue({ supplier }),
  updateAccountingSupplier: vi.fn().mockResolvedValue({ supplier }),
  accountingBills: vi.fn().mockResolvedValue({ bills: [bill] }),
  createAccountingBill: vi.fn().mockResolvedValue({ bill }),
  voidAccountingBill: vi.fn().mockResolvedValue({ bill }),
  payAccountingBill: vi.fn().mockResolvedValue({ bill }),
  voidAccountingPayment: vi.fn().mockResolvedValue({ bill }),
  accountingSummary: vi.fn().mockResolvedValue(summary),
  ...overrides,
});
const openSection = async (api: AccountingApi, name: string) => {
  render(<AccountingPanel api={api} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name }));
};
const openPayments = async (api: AccountingApi) => {
  await openSection(api, "Cargos y pagos");
  fireEvent.click(screen.getByRole("button", { name: `Pagos de ${bill.description}` }));
  return within(screen.getByRole("dialog", { name: `Pagos de ${bill.description}` }));
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("contabilidad administrativa", () => {
  it("consulta un periodo y distingue saldo operativo y cuentas pendientes", async () => {
    const api = createApi();
    await openSection(api, "Resumen");
    expect(screen.getByText("Saldo operativo del periodo")).toBeInTheDocument();
    expect(screen.getByText("Saldo pendiente de cargos")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar periodo" }));
    await waitFor(() => expect(api.accountingSummary).toHaveBeenLastCalledWith({ from: "2026-09-01", to: "2026-09-30" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Consultar periodo" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-02" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Consultar periodo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("periodo válido");
    expect(api.accountingSummary).toHaveBeenCalledTimes(2);
  });

  it("registra, edita y desactiva proveedores conservando la versión vigente", async () => {
    const created = { ...supplier, id: "supplier-2", name: "Verduras de Don Luis", contactName: null, phone: null };
    const edited = { ...created, name: "Verduras Luis", version: 1 };
    const api = createApi({
      accountingSuppliers: vi.fn().mockResolvedValue({ suppliers: [] }),
      createAccountingSupplier: vi.fn().mockResolvedValue({ supplier: created }),
      updateAccountingSupplier: vi.fn().mockResolvedValueOnce({ supplier: edited })
        .mockResolvedValue({ supplier: { ...edited, version: 2, active: false } }),
    });
    await openSection(api, "Proveedores");
    fireEvent.change(screen.getByLabelText("Nombre del proveedor"), { target: { value: " Verduras de Don Luis " } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar proveedor" }));
    await waitFor(() => expect(api.createAccountingSupplier).toHaveBeenCalledWith({
      name: created.name, contactName: null, phone: null, taxId: null, notes: null,
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: `Editar ${created.name}` })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: `Editar ${created.name}` }));
    fireEvent.change(screen.getByLabelText("Nombre del proveedor"), { target: { value: edited.name } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar proveedor" }));
    await waitFor(() => expect(api.updateAccountingSupplier).toHaveBeenCalledWith(created.id, {
      expectedVersion: 0, name: edited.name, contactName: null, phone: null, taxId: null, notes: null,
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: `Desactivar ${edited.name}` })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: `Desactivar ${edited.name}` }));
    await waitFor(() => expect(api.updateAccountingSupplier).toHaveBeenLastCalledWith(created.id, { expectedVersion: 1, active: false }));
    expect(await screen.findByRole("button", { name: `Activar ${edited.name}` })).toBeInTheDocument();
  });

  it("registra cargos de proveedor en centavos y gastos generales sin proveedor", async () => {
    const api = createApi({ createAccountingBill: vi.fn().mockResolvedValue({ bill }) });
    await openSection(api, "Cargos y pagos");
    fireEvent.change(screen.getByLabelText("Proveedor (opcional)"), { target: { value: supplier.id } });
    fireEvent.change(screen.getByLabelText("Concepto del cargo"), { target: { value: " Tortillas de la semana " } });
    fireEvent.change(screen.getByLabelText("Importe del cargo ($ MXN)"), { target: { value: "1250,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cargo" }));
    await waitFor(() => expect(api.createAccountingBill).toHaveBeenCalledWith({
      supplierId: supplier.id, description: bill.description, amountInCents: 125_050,
      issuedOn: today, dueOn: null, reference: null,
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Registrar cargo" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Concepto del cargo"), { target: { value: "Renta" } });
    fireEvent.change(screen.getByLabelText("Importe del cargo ($ MXN)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cargo" }));
    await waitFor(() => expect(api.createAccountingBill).toHaveBeenLastCalledWith({
      supplierId: null, description: "Renta", amountInCents: 500_000,
      issuedOn: today, dueOn: null, reference: null,
    }));
  });

  it("registra un abono externo sin exceder el saldo e incluye el historial", async () => {
    const paidBill = { ...bill, paidInCents: payment.amountInCents, outstandingInCents: 74_950, version: 1, payments: [payment] };
    const api = createApi({ payAccountingBill: vi.fn().mockResolvedValue({ bill: paidBill }) });
    const modal = await openPayments(api);
    fireEvent.change(modal.getByLabelText("Importe del pago ($ MXN)"), { target: { value: "1000.01" } });
    fireEvent.click(modal.getByRole("button", { name: "Registrar pago" }));
    expect(await modal.findByRole("alert")).toHaveTextContent("no puede exceder");
    expect(api.payAccountingBill).not.toHaveBeenCalled();
    fireEvent.change(modal.getByLabelText("Importe del pago ($ MXN)"), { target: { value: "250.50" } });
    fireEvent.change(modal.getByLabelText("Método del pago"), { target: { value: "TRANSFER" } });
    fireEvent.change(modal.getByLabelText("Referencia del pago (opcional)"), { target: { value: " Abono 1 " } });
    fireEvent.click(modal.getByRole("button", { name: "Registrar pago" }));
    await waitFor(() => expect(api.payAccountingBill).toHaveBeenCalledWith(bill.id, {
      expectedVersion: 0, amountInCents: 25_050, methodCode: "TRANSFER", paidOn: today,
      source: "external", reference: "Abono 1",
    }));
    expect(await modal.findByRole("button", { name: /Anular pago de/ })).toBeInTheDocument();
    expect(modal.getByLabelText("Importe del pago ($ MXN)")).toHaveValue("749.50");
  });

  it("vincula efectivo de caja al turno de hoy y muestra errores de caja abierta", async () => {
    const api = createApi({ payAccountingBill: vi.fn().mockRejectedValue(new Error("Abre un turno en esta terminal antes de registrar el pago")) });
    const modal = await openPayments(api);
    fireEvent.change(modal.getByLabelText("Método del pago"), { target: { value: "CARD" } });
    fireEvent.change(modal.getByLabelText("Fecha del pago"), { target: { value: "2020-01-01" } });
    fireEvent.change(modal.getByLabelText("Origen del pago"), { target: { value: "business_cash" } });
    expect(modal.getByLabelText("Método del pago")).toBeDisabled();
    expect(modal.getByLabelText("Método del pago")).toHaveValue("CASH");
    expect(modal.getByLabelText("Fecha del pago")).toHaveValue(today);
    expect(modal.getByLabelText("Fecha del pago")).toBeDisabled();
    fireEvent.click(modal.getByRole("button", { name: "Registrar pago" }));
    await waitFor(() => expect(api.payAccountingBill).toHaveBeenCalledWith(bill.id, {
      expectedVersion: 0, amountInCents: bill.outstandingInCents, methodCode: "CASH", paidOn: today,
      source: "business_cash", reference: null,
    }));
    expect(await modal.findByRole("alert")).toHaveTextContent("Abre un turno");
  });

  it("anula un pago sólo con motivo y conserva el movimiento en el historial", async () => {
    const paidBill = { ...bill, version: 1, paidInCents: payment.amountInCents, outstandingInCents: 74_950, payments: [payment] };
    const voided = { ...bill, version: 2, payments: [{ ...payment, voidedAt: "2026-10-02T12:00:00Z", voidReason: "Capturado dos veces" }] };
    const api = createApi({ accountingBills: vi.fn().mockResolvedValue({ bills: [paidBill] }), voidAccountingPayment: vi.fn().mockResolvedValue({ bill: voided }) });
    const modal = await openPayments(api);
    expect(modal.queryByRole("button", { name: "Anular cargo" })).not.toBeInTheDocument();
    expect(modal.getByText("Para anular este cargo, anula primero sus pagos vigentes.")).toBeInTheDocument();
    fireEvent.click(modal.getByRole("button", { name: /Anular pago de/ }));
    expect(modal.getByRole("button", { name: "Confirmar anulación" })).toBeDisabled();
    fireEvent.change(modal.getByLabelText("Motivo de anulación"), { target: { value: " Capturado dos veces " } });
    fireEvent.click(modal.getByRole("button", { name: "Confirmar anulación" }));
    await waitFor(() => expect(api.voidAccountingPayment).toHaveBeenCalledWith(bill.id, payment.id, { expectedVersion: 1, reason: "Capturado dos veces" }));
    expect(await modal.findByText("Motivo de anulación: Capturado dos veces")).toBeInTheDocument();
    expect(modal.queryByRole("button", { name: /Anular pago de/ })).not.toBeInTheDocument();
    expect(modal.getByLabelText("Importe del pago ($ MXN)")).toHaveValue("1000.00");
    expect(modal.getByRole("button", { name: "Anular cargo" })).toBeInTheDocument();
  });

  it("anula un cargo errado sin pagos y conserva el motivo sin permitir nuevos abonos", async () => {
    const voidedBill = { ...bill, version: 1, outstandingInCents: 0, voidedAt: "2026-10-02T12:00:00Z", voidReason: "Cargo duplicado" };
    const api = createApi({ voidAccountingBill: vi.fn().mockResolvedValue({ bill: voidedBill }) });
    const modal = await openPayments(api);
    fireEvent.click(modal.getByRole("button", { name: "Anular cargo" }));
    expect(modal.getByRole("button", { name: "Confirmar anulación del cargo" })).toBeDisabled();
    fireEvent.change(modal.getByLabelText("Motivo de anulación del cargo"), { target: { value: " Cargo duplicado " } });
    fireEvent.click(modal.getByRole("button", { name: "Confirmar anulación del cargo" }));
    await waitFor(() => expect(api.voidAccountingBill).toHaveBeenCalledWith(bill.id, { expectedVersion: 0, reason: "Cargo duplicado" }));
    expect(await modal.findByText("Cargo anulado. Motivo: Cargo duplicado")).toBeInTheDocument();
    expect(modal.queryByRole("button", { name: "Registrar pago" })).not.toBeInTheDocument();
    expect(modal.queryByRole("button", { name: "Anular cargo" })).not.toBeInTheDocument();
    fireEvent.click(modal.getByRole("button", { name: "Cerrar pagos" }));
    expect(screen.getByText("Anulado")).toBeInTheDocument();
    expect(screen.getByText("Motivo de anulación del cargo: Cargo duplicado")).toBeInTheDocument();
  });

  it("protege las celdas CSV de fórmulas y conserva los centavos", () => {
    const csv = accountingCsv([["=HYPERLINK(\"x\")", " +SUM(1)", "@cmd", "\t=1", "Normal; con comillas \"", 1250.5, -42]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('"\' +SUM(1)"');
    expect(csv).toContain('"\'@cmd"');
    expect(csv).toContain('"\'\t=1"');
    expect(csv).toContain('"Normal; con comillas """');
    expect(csv.endsWith(";1250.5;-42")).toBe(true);
  });
});

describe("importes contables", () => {
  it("convierte pesos exactos y rechaza cantidades ambiguas, cero y desbordamientos", () => {
    expect(accountingPesosToCents("1250,50")).toBe(125_050);
    expect(accountingPesosToCents("0.01")).toBe(1);
    for (const invalid of ["0", "-1", "1.001", "1,000.00", "NaN", "Infinity", "999999999999999999"]) {
      expect(accountingPesosToCents(invalid)).toBeNull();
    }
  });
});
